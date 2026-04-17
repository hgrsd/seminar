"""Worker construction helpers from application config."""

from seminar.config import Config
from seminar.workers.types import (
    ConnectiveResearchWorker,
    FollowUpResearchWorker,
    InitialExplorationWorker,
)

def make_initial_exploration_worker(cfg: Config) -> InitialExplorationWorker:
    return InitialExplorationWorker(
        interval=cfg.intervals.initial,
        timeout=cfg.timeouts.initial,
        agent_cmd=cfg.agent_cmd,
        logs_dir=cfg.logs_dir,
        scratch_dir=cfg.scratch_dir,
        prompt_preamble=_render_skill("initial-exploration.md", cfg),
    )


def make_follow_up_worker(cfg: Config) -> FollowUpResearchWorker:
    return FollowUpResearchWorker(
        interval=cfg.intervals.follow_up,
        timeout=cfg.timeouts.follow_up,
        agent_cmd=cfg.agent_cmd,
        logs_dir=cfg.logs_dir,
        scratch_dir=cfg.scratch_dir,
        prompt_preamble=_render_skill("follow-up-research.md", cfg),
    )


def make_connective_research_worker(cfg: Config) -> ConnectiveResearchWorker:
    return ConnectiveResearchWorker(
        interval=cfg.intervals.connective,
        timeout=cfg.timeouts.connective,
        agent_cmd=cfg.agent_cmd,
        logs_dir=cfg.logs_dir,
        scratch_dir=cfg.scratch_dir,
        prompt_preamble=_render_skill("connective-research.md", cfg),
    )


def _render_skill(filename: str, cfg: Config) -> str:
    """Load a skill template and render the tools placeholder."""
    template_path = cfg.skills_dir / filename
    if not template_path.exists():
        raise FileNotFoundError(
            f"Skill template not found at {template_path}. Run `seminar init` to install skills."
        )
    template = template_path.read_text()
    if cfg.tools:
        tools_block = "Additionally, the following tools are available:\n" + "\n".join(
            f"   - {t}" for t in cfg.tools
        )
    else:
        tools_block = ""
    return template.replace("{{ tools }}", tools_block)
