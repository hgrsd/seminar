"""Study mutation endpoints."""

from dataclasses import asdict

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from seminar.server.broadcast import BroadcastHub
from seminar.server.dependencies import get_hub, get_idea_service, get_pool, get_study_service
from seminar.service.ideas import IdeaService
from seminar.service.studies import StudyService
from seminar.workers import WorkerPool

router = APIRouter(prefix="/api")


class ClaimStudyRequest(BaseModel):
    mode: str


class CompleteStudyRequest(BaseModel):
    markdown_path: str
    mode: str | None = None
    title: str


@router.post("/studies/claim")
def claim_study(
    req: ClaimStudyRequest,
    studies: StudyService = Depends(get_study_service),
    ideas: IdeaService = Depends(get_idea_service),
    hub: BroadcastHub = Depends(get_hub),
):
    try:
        result = studies.claim(req.mode)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    if result.slug is not None:
        hub.publish_event("idea_upserted", asdict(ideas.status_summary(result.slug)))
    return JSONResponse(asdict(result))


@router.post("/studies/{slug}/{study_number}/complete")
def complete_study(
    slug: str,
    study_number: int,
    req: CompleteStudyRequest,
    studies: StudyService = Depends(get_study_service),
    ideas: IdeaService = Depends(get_idea_service),
    pool: WorkerPool = Depends(get_pool),
    hub: BroadcastHub = Depends(get_hub),
):
    try:
        studies.complete(
            slug,
            study_number,
            req.markdown_path,
            mode=req.mode,
            title=req.title,
        )
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    study_filename = studies.get_filename(slug, study_number)
    hub.publish_event("idea_upserted", asdict(ideas.status_summary(slug)))
    hub.publish_event("study_count_updated", {"slug": slug, "count": studies.count_for_idea(slug)})
    pool.wake()
    hub.emit(
        f"Study {slug} #{study_number} published",
        slug=slug,
        study_filename=study_filename,
    )
    return {"ok": True}
