import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import override

from seminar.server.thread_responder import THREAD_RESPONDER_ID, ThreadResponderRunner


class ThreadResponderRunnerTests(unittest.IsolatedAsyncioTestCase):
    temp_dir: tempfile.TemporaryDirectory[str] | None = None

    @override
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()

    @override
    def tearDown(self) -> None:
        if self.temp_dir is not None:
            self.temp_dir.cleanup()

    async def test_launch_from_non_event_loop_thread_schedules_run_on_server_loop(self) -> None:
        loop = asyncio.get_running_loop()
        cfg = SimpleNamespace(
            timeouts=SimpleNamespace(follow_up=60),
            agent_cmd="true",
            logs_dir=Path(self.temp_dir.name) / "logs",
            scratch_dir=Path(self.temp_dir.name) / "scratch",
        )
        runner = ThreadResponderRunner(
            cfg,
            loop,
            run_service=SimpleNamespace(),
            threads=SimpleNamespace(),
            ideas=SimpleNamespace(),
            studies=SimpleNamespace(),
            hub=SimpleNamespace(),
        )
        scheduled = asyncio.Event()
        observed: list[int] = []

        async def fake_run(thread_id: int) -> None:
            observed.append(thread_id)
            scheduled.set()

        runner._run = fake_run  # type: ignore[method-assign]

        caller = threading.Thread(target=runner.launch, args=(42, THREAD_RESPONDER_ID))
        caller.start()
        caller.join()

        await asyncio.wait_for(scheduled.wait(), timeout=1)
        self.assertEqual(observed, [42])
