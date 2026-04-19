"""Worker scheduling: pool management and the main worker loop."""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from seminar import service
from seminar.service.runs import RunService
from seminar.service.studies import StudyService
from seminar.workers.connective_research import ConnectiveResearchExecutor
from seminar.workers.research import ResearchExecutor
from seminar.workers.types import (
    ConnectiveResearchWorker,
    EmitFn,
    EventCallback,
    FollowUpResearchWorker,
    InitialExplorationWorker,
    ThreadResponderWorker,
    WorkerState,
    WorkerType,
)

log = logging.getLogger(__name__)

Executor = ResearchExecutor | ConnectiveResearchExecutor
WorkerStateCallback = Callable[[WorkerState], None]
WorkerRemovedCallback = Callable[[int], None]


def _create_executor(
    worker: WorkerType,
    state: WorkerState,
    study_service: StudyService,
    run_service: RunService,
    emit: EmitFn,
    on_state_change: WorkerStateCallback | None,
) -> Executor:
    match worker:
        case InitialExplorationWorker() | FollowUpResearchWorker():
            return ResearchExecutor(
                worker,
                state,
                study_service,
                run_service,
                emit,
                on_state_change=on_state_change,
            )
        case ConnectiveResearchWorker():
            return ConnectiveResearchExecutor(
                worker,
                state,
                run_service,
                emit,
                on_state_change=on_state_change,
            )
        case ThreadResponderWorker():
            raise ValueError("Thread responder workers are launched on-demand, not through WorkerPool")


@dataclass
class WorkerPool:
    """Manages a set of worker tasks."""

    study_service: StudyService
    run_service: RunService
    on_event: EventCallback | None = None
    on_worker_state: WorkerStateCallback | None = None
    on_worker_removed: WorkerRemovedCallback | None = None
    workers: dict[int, asyncio.Task] = field(default_factory=dict)
    states: dict[int, WorkerState] = field(default_factory=dict)
    _next_id: int = 1
    _shutdown: asyncio.Event = field(default_factory=asyncio.Event)
    _wake: asyncio.Event = field(default_factory=asyncio.Event)

    def _emit(self, message: str, **extra: Any) -> None:
        if self.on_event:
            self.on_event({"message": message, **extra})

    def spawn(self, worker: WorkerType) -> int:
        """Spawn a new worker, returning its ID."""
        wid = self._next_id
        self._next_id += 1
        state = WorkerState(worker_type=worker, worker_id=wid)
        self.states[wid] = state
        executor = _create_executor(
            worker,
            state,
            self.study_service,
            self.run_service,
            self._emit,
            self.on_worker_state,
        )
        self.workers[wid] = asyncio.create_task(
            _worker_loop(
                executor,
                state,
                self._shutdown,
                self._wake,
                self.on_worker_state,
            ),
            name=f"worker-{wid}",
        )
        if self.on_worker_state:
            self.on_worker_state(state)
        return wid

    async def remove(self, wid: int) -> None:
        """Cancel a worker and wait for it to finish."""
        task = self.workers.pop(wid, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self.states.pop(wid, None)
        if self.on_worker_removed:
            self.on_worker_removed(wid)

    def kill_task(self, wid: int) -> bool:
        """Kill the current subprocess of a worker without removing the worker."""
        ws = self.states.get(wid)
        if not ws or not ws._proc or ws._proc.returncode is not None:
            return False
        ws._proc.kill()
        return True

    def wake(self) -> None:
        """Interrupt all sleeping workers so they start their next cycle immediately."""
        self._wake.set()

    async def shutdown(self) -> None:
        """Signal all workers to stop and wait for them."""
        self._shutdown.set()
        for task in self.workers.values():
            task.cancel()
        await asyncio.gather(*self.workers.values(), return_exceptions=True)
        self.workers.clear()
        self.states.clear()


async def _worker_loop(
    executor: Executor,
    state: WorkerState,
    shutdown: asyncio.Event,
    wake: asyncio.Event,
    on_state_change: WorkerStateCallback | None,
) -> None:
    while not shutdown.is_set():
        if not service.is_paused():
            try:
                await executor.execute()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Worker %d error", state.worker_id)

        state.reset()
        if on_state_change:
            on_state_change(state)
        await _interruptible_sleep(shutdown, wake, state.worker_type.interval)


async def _interruptible_sleep(
    shutdown: asyncio.Event,
    wake: asyncio.Event,
    seconds: float,
) -> None:
    wake.clear()
    _, pending = await asyncio.wait(
        [asyncio.create_task(shutdown.wait()), asyncio.create_task(wake.wait())],
        timeout=seconds,
        return_when=asyncio.FIRST_COMPLETED,
    )
    for task in pending:
        task.cancel()
