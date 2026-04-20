import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import create_autospec
from typing import override

from seminar.config import Config, IntervalsConfig, TimeoutsConfig, WorkersConfig
from seminar.server.broadcast import BroadcastHub
from seminar.server.thread_responder import THREAD_RESPONDER_ID, ThreadResponderRunner
from seminar.service.ideas import IdeaService
from seminar.service.runs import RunService
from seminar.service.studies import StudyService
from seminar.service.threads import ThreadService


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
        temp_dir = self.temp_dir
        assert temp_dir is not None
        cfg = Config(
            data_dir=temp_dir.name,
            provider="codex",
            agent_cmd="true",
            intervals=IntervalsConfig(initial=60, follow_up=60, connective=60),
            timeouts=TimeoutsConfig(initial=60, follow_up=60, connective=60),
            workers=WorkersConfig(initial=1, follow_up=1, connective=1),
            follow_up_research_cooldown_minutes=60,
        )
        runner = ThreadResponderRunner(
            cfg,
            loop,
            run_service=create_autospec(RunService, instance=True),
            threads=create_autospec(ThreadService, instance=True),
            ideas=create_autospec(IdeaService, instance=True),
            studies=create_autospec(StudyService, instance=True),
            hub=create_autospec(BroadcastHub, instance=True),
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
