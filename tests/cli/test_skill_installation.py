import tempfile
import unittest
from pathlib import Path

from seminar.cli import _install_default_skills
from seminar.config import Config, IntervalsConfig, TimeoutsConfig, WorkersConfig
from seminar.workers.factory import _render_skill


class SkillInstallationTests(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str] | None = None

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        if self.temp_dir is not None:
            self.temp_dir.cleanup()

    def test_init_installs_default_skills_into_data_dir(self) -> None:
        cfg = self._config()

        _install_default_skills(cfg)

        self.assertEqual(
            sorted(path.name for path in cfg.skills_dir.iterdir()),
            [
                "connective-research.md",
                "follow-up-research.md",
                "initial-exploration.md",
            ],
        )

    def test_render_skill_uses_installed_copy(self) -> None:
        cfg = self._config()
        _install_default_skills(cfg)
        installed_path = cfg.skills_dir / "initial-exploration.md"
        original = installed_path.read_text()
        installed_path.write_text(original.replace("{{ tools }}", "INSTALLED-SKILL-MARKER"))

        rendered = _render_skill("initial-exploration.md", cfg)

        self.assertIn("INSTALLED-SKILL-MARKER", rendered)

    def _config(self) -> Config:
        return Config(
            data_dir=str(self.data_dir),
            provider="codex",
            agent_cmd="codex exec",
            intervals=IntervalsConfig(initial=30, follow_up=600, connective=900),
            timeouts=TimeoutsConfig(initial=1500, follow_up=1500, connective=1500),
            workers=WorkersConfig(initial=1, follow_up=1, connective=0),
            follow_up_research_cooldown_minutes=10,
            tools=[],
        )
