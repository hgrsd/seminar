"""Shared worker serialization helpers for API snapshots and websocket events."""

from __future__ import annotations

from typing import Iterable

from seminar.workers import WorkerPool


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


def serialize_workers(
    pool: WorkerPool,
    provider: str,
    extra_states: Iterable[tuple[int, object]] = (),
) -> list[dict]:
    combined = [*pool.states.items(), *extra_states]
    return [serialize_worker(wid, ws, provider) for wid, ws in sorted(combined)]
