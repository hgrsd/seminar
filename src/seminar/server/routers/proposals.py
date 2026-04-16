"""Proposal endpoints."""

from dataclasses import asdict

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from seminar.server.broadcast import BroadcastHub
from seminar.server.dependencies import get_hub, get_idea_service, get_proposal_service
from seminar.service.ideas import IdeaService
from seminar.service.proposals import ProposalService
from seminar.service import validate_slug

router = APIRouter(prefix="/api")


class CreateProposalRequest(BaseModel):
    slug: str
    title: str
    author: str
    body: str
    parent_slugs: list[str] = []


@router.post("/proposals")
def create_proposal(
    req: CreateProposalRequest,
    proposals: ProposalService = Depends(get_proposal_service),
    hub: BroadcastHub = Depends(get_hub),
):
    try:
        slug = validate_slug(req.slug)
        if not req.body.strip():
            raise ValueError("proposal body cannot be empty.")
        if not req.parent_slugs:
            raise ValueError(
                "proposals must include the slug(s) of the idea(s) that inspired them."
            )
        proposals.propose(
            slug,
            req.body,
            title=req.title,
            author=req.author.strip(),
            parent_slugs=req.parent_slugs,
        )
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    summary = proposals.summary(slug)
    if summary is not None:
        hub.publish_event("proposal_upserted", asdict(summary))
    hub.emit(f"Created proposal {slug}", proposal_slug=slug)
    return {"ok": True, "slug": slug}


@router.get("/proposals")
def list_proposals(proposals: ProposalService = Depends(get_proposal_service)):
    return proposals.list_all()


@router.get("/proposals/{slug}/content")
def get_proposal_content(
    slug: str, proposals: ProposalService = Depends(get_proposal_service)
):
    result = proposals.read(slug)
    if result is None:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse(asdict(result))


@router.post("/proposals/{slug}/approve")
def approve_proposal(
    slug: str,
    proposals: ProposalService = Depends(get_proposal_service),
    ideas: IdeaService = Depends(get_idea_service),
    hub: BroadcastHub = Depends(get_hub),
):
    try:
        slug = proposals.approve(slug, ideas)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    summary = proposals.summary(slug)
    if summary is not None:
        hub.publish_event("proposal_upserted", asdict(summary))
    hub.publish_event("idea_upserted", asdict(ideas.status_summary(slug)))
    hub.publish_event("study_count_updated", {"slug": slug, "count": 0})
    hub.emit(f"Approved proposal {slug} \u2192 {slug}", slug=slug, proposal_slug=slug)
    return {"ok": True, "slug": slug}


@router.post("/proposals/{slug}/reject")
def reject_proposal(
    slug: str,
    proposals: ProposalService = Depends(get_proposal_service),
    hub: BroadcastHub = Depends(get_hub),
):
    try:
        proposals.reject(slug)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    summary = proposals.summary(slug)
    if summary is not None:
        hub.publish_event("proposal_upserted", asdict(summary))
    hub.emit(f"Rejected proposal {slug}", proposal_slug=slug)
    return {"ok": True}


@router.delete("/proposals/{slug}")
def delete_proposal(
    slug: str,
    proposals: ProposalService = Depends(get_proposal_service),
    hub: BroadcastHub = Depends(get_hub),
):
    proposals.delete(slug)
    hub.publish_event("proposal_deleted", {"slug": slug})
    hub.emit(f"Deleted proposal {slug}", proposal_slug=slug)
    return {"ok": True}
