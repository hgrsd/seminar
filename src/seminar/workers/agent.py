"""Shared agent subprocess infrastructure."""

import asyncio
import shlex
from datetime import datetime, timezone

from seminar.service.runs import RunService
from seminar.workers.types import (
    AgentResult,
    SpawnProcess,
    WorkerState,
    WorkerStatus,
    WorkerType,
)


async def default_spawn(
    argv: list[str],
    stdout,
    stderr,
    cwd: str | None = None,
) -> asyncio.subprocess.Process:
    return await asyncio.create_subprocess_exec(
        *argv, stdout=stdout, stderr=stderr, cwd=cwd
    )


async def run_agent(
    state: WorkerState,
    worker: WorkerType,
    run_service: RunService,
    spawn_process: SpawnProcess,
    on_state_change,
    prompt: str,
    *,
    slug: str | None = None,
    study_number: int | None = None,
    cwd: str | None = None,
) -> AgentResult:
    """Run an agent subprocess, managing log files and run records."""
    state.status = WorkerStatus.RESEARCHING
    state.current_slug = slug
    state.started_at = asyncio.get_running_loop().time()
    state.started_at_wall = datetime.now(timezone.utc).isoformat()
    if on_state_change:
        on_state_change(state)
    try:
        argv = shlex.split(worker.agent_cmd)
    except ValueError as exc:
        raise ValueError(f"Invalid agent_cmd: {worker.agent_cmd!r}") from exc
    if not argv:
        raise ValueError("Invalid agent_cmd: command is empty")

    log_filename = worker.log_filename(state.worker_id, slug, study_number)
    run_id = run_service.start(
        worker_id=state.worker_id,
        run_type=worker.run_type,
        slug=slug,
        study_number=study_number,
        log_file=log_filename,
    )

    result = AgentResult()
    worker.logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = worker.logs_dir / log_filename

    try:
        with open(log_path, "w") as log_fh:
            state.log_file = log_path
            if on_state_change:
                on_state_change(state)

            proc = await spawn_process(
                [*argv, prompt],
                stdout=log_fh,
                stderr=asyncio.subprocess.STDOUT,
                cwd=cwd,
            )
            state._proc = proc
            result.timed_out = await _wait_for_proc(proc, worker.timeout)
            result.exit_code = proc.returncode
    finally:
        elapsed = (
            asyncio.get_running_loop().time() - state.started_at
            if state.started_at
            else None
        )
        run_service.finish(
            run_id,
            exit_code=result.exit_code,
            timed_out=result.timed_out,
            duration_ms=int(elapsed * 1000) if elapsed else None,
        )

    return result


async def _wait_for_proc(proc: asyncio.subprocess.Process, timeout: float | None) -> bool:
    """Wait for process exit with optional timeout. Returns True if killed due to timeout."""
    try:
        await asyncio.wait_for(proc.wait(), timeout=timeout)
        return False
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return True
