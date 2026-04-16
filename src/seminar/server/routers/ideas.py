"""Idea endpoints."""

import sqlite3
from dataclasses import asdict

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from seminar.server.broadcast import BroadcastHub
from seminar.service import validate_slug
from seminar.service.ideas import IdeaService
from seminar.service.studies import StudyService
from seminar.server.dependencies import get_hub, get_idea_service, get_study_service

router = APIRouter(prefix="/api")


class CreateIdeaRequest(BaseModel):
    slug: str
    title: str
    author: str
    body: str = ""


@router.get("/ideas/{slug}/content")
def get_idea_content(slug: str, ideas: IdeaService = Depends(get_idea_service)):
    result = ideas.content(slug)
    if result is None:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse(asdict(result))


@router.get("/ideas/{slug}/studies")
def get_idea_studies(slug: str, studies: StudyService = Depends(get_study_service)):
    return studies.for_idea(slug)


@router.get("/ideas/{slug}/sources")
def get_idea_sources(slug: str, ideas: IdeaService = Depends(get_idea_service)):
    return ideas.sources(slug)


@router.get("/ideas/{slug}/children")
def get_idea_children(slug: str, ideas: IdeaService = Depends(get_idea_service)):
    return ideas.children(slug)


@router.post("/ideas")
def create_idea(
    req: CreateIdeaRequest,
    ideas: IdeaService = Depends(get_idea_service),
    hub: BroadcastHub = Depends(get_hub),
):
    try:
        slug = validate_slug(req.slug)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    try:
        ideas.create(slug, req.body, title=req.title, author=req.author.strip())
    except sqlite3.IntegrityError:
        return JSONResponse({"error": f"Idea '{slug}' already exists"}, status_code=409)

    hub.publish_event("idea_upserted", asdict(ideas.status_summary(slug)))
    hub.publish_event("study_count_updated", {"slug": slug, "count": 0})
    hub.emit(f"Created idea {slug}", slug=slug)
    return {"ok": True, "slug": slug}


class DirectorNoteRequest(BaseModel):
    body: str


@router.post("/ideas/{slug}/director-note")
def add_director_note(
    slug: str,
    req: DirectorNoteRequest,
    ideas: IdeaService = Depends(get_idea_service),
    studies: StudyService = Depends(get_study_service),
    hub: BroadcastHub = Depends(get_hub),
):
    study_number = studies.add_director_note(slug, req.body)
    hub.publish_event("idea_upserted", asdict(ideas.status_summary(slug)))
    hub.publish_event("study_count_updated", {"slug": slug, "count": studies.count_for_idea(slug)})
    hub.emit(f"Director's note added to {slug}", slug=slug)
    return {"ok": True, "study_number": study_number}


@router.post("/ideas/{slug}/done")
def mark_idea_done(
    slug: str,
    ideas: IdeaService = Depends(get_idea_service),
    hub: BroadcastHub = Depends(get_hub),
):
    ideas.mark_done(slug)
    hub.publish_event("idea_upserted", asdict(ideas.status_summary(slug)))
    hub.emit(f"Marked {slug} as done", slug=slug)
    return {"ok": True}


@router.post("/ideas/{slug}/reopen")
def reopen_idea(
    slug: str,
    ideas: IdeaService = Depends(get_idea_service),
    hub: BroadcastHub = Depends(get_hub),
):
    ideas.reopen(slug)
    hub.publish_event("idea_upserted", asdict(ideas.status_summary(slug)))
    hub.emit(f"Reopened {slug} for follow-up research", slug=slug)
    return {"ok": True}


@router.post("/ideas/{slug}/reset")
def reset_idea(
    slug: str,
    ideas: IdeaService = Depends(get_idea_service),
    hub: BroadcastHub = Depends(get_hub),
):
    ideas.reset(slug)
    hub.publish_event("idea_upserted", asdict(ideas.status_summary(slug)))
    hub.publish_event("study_count_updated", {"slug": slug, "count": 0})
    hub.emit(f"Reset {slug}", slug=slug)
    return {"ok": True}


@router.post("/ideas/reset-all")
def reset_all_ideas(
    ideas: IdeaService = Depends(get_idea_service),
    studies: StudyService = Depends(get_study_service),
    hub: BroadcastHub = Depends(get_hub),
):
    ideas.reset_all()
    for idea in ideas.status_all():
        hub.publish_event("idea_upserted", asdict(idea))
    hub.publish_event("study_counts_replaced", studies.counts())
    hub.emit("Reset all ideas")
    return {"ok": True}


@router.delete("/ideas/{slug}")
def delete_idea(
    slug: str,
    ideas: IdeaService = Depends(get_idea_service),
    hub: BroadcastHub = Depends(get_hub),
):
    ideas.delete(slug)
    hub.publish_event("idea_deleted", {"slug": slug})
    hub.publish_event("study_count_updated", {"slug": slug, "count": 0})
    hub.emit(f"Deleted idea {slug}", slug=slug)
    return {"ok": True}
