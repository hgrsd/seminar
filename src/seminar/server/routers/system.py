"""System endpoints: pause/resume, search, and runtime settings."""

from dataclasses import replace

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from seminar import config, providers, service
from seminar.config import Config, IntervalsConfig, TimeoutsConfig, WorkersConfig
from seminar.server.broadcast import BroadcastHub
from seminar.server.dependencies import get_cfg, get_hub, get_pool, get_search_service
from seminar.service.search import SearchService
from seminar.workers import WorkerPool
from seminar.workers.factory import (
    make_connective_research_worker,
    make_follow_up_worker,
    make_initial_exploration_worker,
)

router = APIRouter(prefix="/api")


class WorkerSettingsModel(BaseModel):
    initial: int = Field(ge=0)
    follow_up: int = Field(ge=0)
    connective: int = Field(ge=0)


class TimingSettingsModel(BaseModel):
    initial: int = Field(gt=0)
    follow_up: int = Field(gt=0)
    connective: int = Field(gt=0)


class SettingsUpdateRequest(BaseModel):
    provider: str
    agent_cmd: str = Field(min_length=1)
    intervals: TimingSettingsModel
    timeouts: TimingSettingsModel
    workers: WorkerSettingsModel
    follow_up_research_cooldown_minutes: int = Field(ge=0)
    tools: list[str] = Field(default_factory=list)


def _serialize_settings(cfg: Config) -> dict:
    return {
        "provider": cfg.provider,
        "agent_cmd": cfg.agent_cmd,
        "intervals": {
            "initial": cfg.intervals.initial,
            "follow_up": cfg.intervals.follow_up,
            "connective": cfg.intervals.connective,
        },
        "timeouts": {
            "initial": cfg.timeouts.initial,
            "follow_up": cfg.timeouts.follow_up,
            "connective": cfg.timeouts.connective,
        },
        "workers": {
            "initial": cfg.workers.initial,
            "follow_up": cfg.workers.follow_up,
            "connective": cfg.workers.connective,
        },
        "follow_up_research_cooldown_minutes": cfg.follow_up_research_cooldown_minutes,
        "tools": cfg.tools,
        "available_providers": sorted(providers.PROVIDERS),
    }


def _copy_worker_settings(target, source) -> None:
    target.interval = source.interval
    target.timeout = source.timeout
    target.agent_cmd = source.agent_cmd
    target.prompt_preamble = source.prompt_preamble


def _apply_runtime_settings(request: Request, cfg: Config) -> None:
    app = request.app
    app.state.cfg = cfg
    app.state.study_service.cooldown_minutes = cfg.follow_up_research_cooldown_minutes
    app.state.run_service.set_provider(cfg.provider, providers.load(cfg.provider))

    worker_factories = {
        "initial_exploration": lambda: make_initial_exploration_worker(cfg),
        "follow_up_research": lambda: make_follow_up_worker(cfg),
        "connective_research": lambda: make_connective_research_worker(cfg),
    }

    for state in app.state.pool.states.values():
        worker_type = state.worker_type.run_type.value
        template = worker_factories[worker_type]()
        _copy_worker_settings(state.worker_type, template)
    app.state.pool.wake()


@router.get("/providers")
def get_providers():
    result = {}
    for name in sorted(providers.PROVIDERS):
        provider = providers.load(name)
        result[name] = {"default_cmd": provider.agent_cmd_default()}
    return result


@router.get("/search")
def search_content(q: str = "", search: SearchService = Depends(get_search_service)):
    if not q or len(q) < 2:
        return []
    return search.search(q)


@router.post("/pause")
def pause_fleet(hub: BroadcastHub = Depends(get_hub)):
    service.pause()
    hub.publish_event("paused_changed", True)
    hub.emit("Fleet paused")
    return {"ok": True}


@router.post("/resume")
async def resume_fleet(
    pool: WorkerPool = Depends(get_pool),
    hub: BroadcastHub = Depends(get_hub),
):
    service.resume()
    pool.wake()
    hub.publish_event("paused_changed", False)
    hub.emit("Fleet resumed")
    return {"ok": True}


@router.get("/settings")
def get_settings(cfg: Config = Depends(get_cfg)):
    return _serialize_settings(cfg)


@router.put("/settings")
async def update_settings(
    payload: SettingsUpdateRequest,
    request: Request,
    cfg: Config = Depends(get_cfg),
    hub: BroadcastHub = Depends(get_hub),
):
    providers.load(payload.provider)
    next_cfg = replace(
        cfg,
        provider=payload.provider,
        agent_cmd=payload.agent_cmd.strip(),
        intervals=IntervalsConfig(**payload.intervals.model_dump()),
        timeouts=TimeoutsConfig(**payload.timeouts.model_dump()),
        workers=WorkersConfig(**payload.workers.model_dump()),
        follow_up_research_cooldown_minutes=payload.follow_up_research_cooldown_minutes,
        tools=[t for t in payload.tools if t.strip()],
    )
    config.save(next_cfg)
    _apply_runtime_settings(request, next_cfg)
    hub.emit("Updated settings")
    return _serialize_settings(next_cfg)
