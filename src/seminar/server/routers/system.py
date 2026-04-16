"""System endpoints: pause/resume, search."""

from fastapi import APIRouter, Depends

from seminar import service
from seminar.server.broadcast import BroadcastHub
from seminar.service.search import SearchService
from seminar.server.dependencies import get_hub, get_pool, get_search_service
from seminar.workers import WorkerPool

router = APIRouter(prefix="/api")


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
