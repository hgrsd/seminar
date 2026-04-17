"""Inbox message endpoints."""

from dataclasses import asdict

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from seminar.server.broadcast import BroadcastHub
from seminar.server.dependencies import get_hub, get_message_service
from seminar.service.messages import MessageService

router = APIRouter(prefix="/api")


class CreateMessageRequest(BaseModel):
    title: str
    body: str
    author: str
    idea_slug: str | None = None


@router.post("/messages")
def create_message(
    req: CreateMessageRequest,
    messages: MessageService = Depends(get_message_service),
    hub: BroadcastHub = Depends(get_hub),
):
    try:
        id = messages.send(req.title, req.body, req.author, idea_slug=req.idea_slug)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    summary = messages.get(id)
    if summary is not None:
        hub.publish_event("message_upserted", asdict(summary))
    hub.emit(f"New message: {req.title}", message_id=id)
    return {"ok": True, "id": id}


@router.get("/messages")
def list_messages(messages: MessageService = Depends(get_message_service)):
    return [asdict(m) for m in messages.list_all()]


@router.get("/messages/{id}/content")
def get_message_content(id: int, messages: MessageService = Depends(get_message_service)):
    result = messages.read_content(id)
    if result is None:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse(asdict(result))


@router.post("/messages/{id}/mark-read")
def mark_read_message(
    id: int,
    messages: MessageService = Depends(get_message_service),
    hub: BroadcastHub = Depends(get_hub),
):
    try:
        messages.mark_read(id)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    summary = messages.get(id)
    if summary is not None:
        hub.publish_event("message_upserted", asdict(summary))
    return {"ok": True}


@router.delete("/messages/{id}")
def delete_message(
    id: int,
    messages: MessageService = Depends(get_message_service),
    hub: BroadcastHub = Depends(get_hub),
):
    messages.delete(id)
    hub.publish_event("message_deleted", {"id": id})
    return {"ok": True}
