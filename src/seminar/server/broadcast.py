"""WebSocket broadcast hub and activity event system."""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import WebSocket

log = logging.getLogger(__name__)

SnapshotFactory = Callable[[], dict[str, Any]]


class BroadcastHub:
    """Manages WebSocket connections and structured state/activity events."""

    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._activities: list[dict[str, Any]] = []
        self._loop: asyncio.AbstractEventLoop | None = None
        self._snapshot_factory: SnapshotFactory | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def set_snapshot_factory(self, factory: SnapshotFactory) -> None:
        self._snapshot_factory = factory

    @property
    def activities(self) -> list[dict[str, Any]]:
        return list(reversed(self._activities))

    async def broadcast(self, message: dict[str, Any]) -> None:
        data = json.dumps(message)
        dead = set()
        for ws in self._connections:
            try:
                await ws.send_text(data)
            except Exception:
                dead.add(ws)
        self._connections.difference_update(dead)

    def publish(self, message: dict[str, Any]) -> None:
        if self._loop is not None and self._loop.is_running():
            self._loop.call_soon_threadsafe(
                asyncio.ensure_future,
                self.broadcast(message),
            )

    def publish_event(self, event_type: str, data: Any) -> None:
        self.publish({"type": event_type, "data": data})

    def on_event(self, event: dict[str, Any]) -> None:
        """Handle a structured activity event from a worker or server."""
        ts = datetime.now(timezone.utc).isoformat()
        entry = {**event, "ts": ts}
        self._activities.append(entry)
        if len(self._activities) > 100:
            del self._activities[:50]
        self.publish_event("activity_logged", entry)

    def emit(self, message: str, **extra: Any) -> None:
        """Convenience for emitting activity events from server code."""
        self.on_event({"message": message, **extra})

    @asynccontextmanager
    async def connect(self, ws: WebSocket):
        """Accept a WebSocket and track it; removes on disconnect."""
        await ws.accept()
        self._connections.add(ws)
        try:
            yield
        finally:
            self._connections.discard(ws)

    async def send_snapshot(self, ws: WebSocket) -> None:
        """Send a full state snapshot to a newly connected WebSocket."""
        if self._snapshot_factory is None:
            payload: dict[str, Any] = {}
        else:
            try:
                payload = self._snapshot_factory()
            except Exception:
                log.exception("Error building websocket snapshot")
                payload = {}
        await ws.send_text(json.dumps({"type": "snapshot", "data": payload}))
