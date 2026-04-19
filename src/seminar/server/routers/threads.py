"""Thread conversation endpoints."""

from dataclasses import asdict

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from seminar.server.broadcast import BroadcastHub
from seminar.server.dependencies import get_hub, get_thread_runner, get_thread_service
from seminar.server.thread_responder import THREAD_RESPONDER_ID, ThreadResponderRunner
from seminar.service.threads import ThreadService

router = APIRouter(prefix="/api")


class CreateThreadRequest(BaseModel):
    title: str
    body: str
    author_name: str
    idea_slug: str | None = None


class AddThreadMessageRequest(BaseModel):
    body: str
    author_name: str


@router.get("/responders")
def list_responders(runner: ThreadResponderRunner = Depends(get_thread_runner)):
    return runner.available_responders()


@router.get("/threads")
def list_threads(threads: ThreadService = Depends(get_thread_service)):
    return [asdict(t) for t in threads.list_all()]


@router.post("/threads")
def create_thread(
    req: CreateThreadRequest,
    threads: ThreadService = Depends(get_thread_service),
    runner: ThreadResponderRunner = Depends(get_thread_runner),
    hub: BroadcastHub = Depends(get_hub),
):
    try:
        thread_id = threads.create(
            req.title,
            req.body,
            author_type="user",
            author_name=req.author_name,
            idea_slug=req.idea_slug,
        )
        threads.update_pending_response(thread_id, responder=THREAD_RESPONDER_ID)
        runner.launch(thread_id, THREAD_RESPONDER_ID)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    summary = threads.get(thread_id)
    detail = threads.get_detail(thread_id)
    if summary is not None:
        hub.publish_event("thread_upserted", asdict(summary))
    if detail is not None and detail.messages:
        hub.publish_event("thread_message_added", asdict(detail.messages[-1]))
    hub.emit(f"Created thread: {req.title}", thread_id=thread_id)
    return {"ok": True, "id": thread_id}


class CreateAgentThreadRequest(BaseModel):
    title: str
    body: str
    author_name: str
    idea_slug: str | None = None


@router.post("/threads/agent")
def create_agent_thread(
    req: CreateAgentThreadRequest,
    threads: ThreadService = Depends(get_thread_service),
    hub: BroadcastHub = Depends(get_hub),
):
    try:
        thread_id = threads.create(
            req.title,
            req.body,
            author_type="agent",
            author_name=req.author_name,
            idea_slug=req.idea_slug,
        )
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    summary = threads.get(thread_id)
    detail = threads.get_detail(thread_id)
    if summary is not None:
        hub.publish_event("thread_upserted", asdict(summary))
    if detail is not None and detail.messages:
        hub.publish_event("thread_message_added", asdict(detail.messages[-1]))
    hub.emit(f"New thread: {req.title}", thread_id=thread_id)
    return {"ok": True, "id": thread_id}


@router.get("/threads/{thread_id}")
def get_thread(thread_id: int, threads: ThreadService = Depends(get_thread_service)):
    detail = threads.get_detail(thread_id)
    if detail is None:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse(asdict(detail))


@router.post("/threads/{thread_id}/messages")
def add_thread_message(
    thread_id: int,
    req: AddThreadMessageRequest,
    threads: ThreadService = Depends(get_thread_service),
    runner: ThreadResponderRunner = Depends(get_thread_runner),
    hub: BroadcastHub = Depends(get_hub),
):
    try:
        message_id = threads.add_message(
            thread_id,
            author_type="user",
            author_name=req.author_name,
            body=req.body,
            responder=THREAD_RESPONDER_ID,
        )
        threads.update_pending_response(thread_id, responder=THREAD_RESPONDER_ID)
        runner.launch(thread_id, THREAD_RESPONDER_ID)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    summary = threads.get(thread_id)
    detail = threads.get_detail(thread_id)
    if summary is not None:
        hub.publish_event("thread_upserted", asdict(summary))
    if detail is not None:
        message = next((m for m in detail.messages if m.id == message_id), None)
        if message is not None:
            hub.publish_event("thread_message_added", asdict(message))
    hub.emit(f"User replied in thread #{thread_id}", thread_id=thread_id)
    return {"ok": True}


class AgentReplyRequest(BaseModel):
    body: str
    author_name: str


@router.post("/threads/{thread_id}/agent-reply")
def add_agent_reply(
    thread_id: int,
    req: AgentReplyRequest,
    threads: ThreadService = Depends(get_thread_service),
    hub: BroadcastHub = Depends(get_hub),
):
    try:
        message_id = threads.add_message(
            thread_id,
            author_type="agent",
            author_name=req.author_name,
            body=req.body,
        )
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    summary = threads.get(thread_id)
    detail = threads.get_detail(thread_id)
    if summary is not None:
        hub.publish_event("thread_upserted", asdict(summary))
    if detail is not None:
        message = next((m for m in detail.messages if m.id == message_id), None)
        if message is not None:
            hub.publish_event("thread_message_added", asdict(message))
    hub.emit(f"Agent replied in thread #{thread_id}", thread_id=thread_id)
    return {"ok": True}


@router.post("/threads/{thread_id}/close")
def close_thread(
    thread_id: int,
    threads: ThreadService = Depends(get_thread_service),
    hub: BroadcastHub = Depends(get_hub),
):
    try:
        threads.close(thread_id)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    summary = threads.get(thread_id)
    if summary is not None:
        hub.publish_event("thread_upserted", asdict(summary))
    hub.emit(f"Closed thread #{thread_id}", thread_id=thread_id)
    return {"ok": True}


@router.delete("/threads/{thread_id}")
def delete_thread(
    thread_id: int,
    threads: ThreadService = Depends(get_thread_service),
    hub: BroadcastHub = Depends(get_hub),
):
    threads.delete(thread_id)
    hub.publish_event("thread_deleted", {"id": thread_id})
    return {"ok": True}
