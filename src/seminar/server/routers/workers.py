"""Worker endpoints."""

import asyncio
import logging
from dataclasses import asdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from seminar.config import Config
from seminar.server.broadcast import BroadcastHub
from seminar.service.runs import RunService
from seminar.server.dependencies import get_cfg, get_hub, get_pool, get_run_service
from seminar.workers import WorkerPool
from seminar.workers.factory import (
    make_connective_research_worker,
    make_follow_up_worker,
    make_initial_exploration_worker,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


class SpawnWorkerRequest(BaseModel):
    type: str


def serialize_workers(pool: WorkerPool, provider: str) -> list[dict]:
    return [serialize_worker(wid, ws, provider) for wid, ws in sorted(pool.states.items())]


def serialize_worker(worker_id: int, ws, provider: str) -> dict:
    return {
        "id": worker_id,
        "type": ws.worker_type.run_type.value,
        "provider": provider,
        "status": ws.status.value,
        "current_slug": ws.current_slug,
        "started_at": ws.started_at_wall,
        "log_file": str(ws.log_file) if ws.log_file else None,
    }


@router.get("/workers")
def get_workers(
    pool: WorkerPool = Depends(get_pool),
    cfg: Config = Depends(get_cfg),
):
    return serialize_workers(pool, cfg.provider)


@router.post("/workers")
async def spawn_worker(
    req: SpawnWorkerRequest,
    pool: WorkerPool = Depends(get_pool),
    cfg: Config = Depends(get_cfg),
    hub: BroadcastHub = Depends(get_hub),
):
    factory_map = {
        "initial_exploration": make_initial_exploration_worker,
        "follow_up_research": make_follow_up_worker,
        "connective_research": make_connective_research_worker,
    }
    factory = factory_map.get(req.type)
    if factory is None:
        return JSONResponse({"error": f"unknown type: {req.type}"}, status_code=400)
    wid = pool.spawn(factory(cfg))
    hub.emit(f"Added {req.type} worker #{wid}", worker_id=wid)
    return {"id": wid}


@router.delete("/workers/{worker_id}")
async def remove_worker(
    worker_id: int,
    pool: WorkerPool = Depends(get_pool),
    hub: BroadcastHub = Depends(get_hub),
):
    if worker_id not in pool.states:
        return JSONResponse({"error": "not found"}, status_code=404)
    wtype = pool.states[worker_id].worker_type.run_type.value
    await pool.remove(worker_id)
    hub.emit(f"Removed {wtype} worker #{worker_id}", worker_id=worker_id)
    return {"ok": True}


@router.post("/workers/{worker_id}/kill")
async def kill_worker_task(
    worker_id: int,
    pool: WorkerPool = Depends(get_pool),
    hub: BroadcastHub = Depends(get_hub),
):
    if worker_id not in pool.states:
        return JSONResponse({"error": "not found"}, status_code=404)
    if not pool.kill_task(worker_id):
        return JSONResponse({"error": "no active task"}, status_code=409)
    slug = pool.states[worker_id].current_slug
    hub.emit(f"Killed task for worker #{worker_id}", slug=slug, worker_id=worker_id)
    return {"ok": True}


@router.get("/workers/runs")
def get_worker_runs(runs: RunService = Depends(get_run_service), date: str | None = None):
    if date is None:
        date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return JSONResponse({"runs": [asdict(r) for r in runs.by_date(date)]})


@router.get("/workers/{worker_id}/history/{filename}")
def get_worker_history_log(worker_id: int, filename: str, runs: RunService = Depends(get_run_service)):
    try:
        events = runs.parse_log_file(worker_id, filename)
    except Exception:
        log.exception("Error parsing log file %s", filename)
        return JSONResponse({"events": []})
    if events is None:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse({"events": [asdict(e) for e in events]})
