import type { RunEntry, Worker, WorkerLogEvent } from "../types";
import { getJson, sendJson } from "./client";

export function listWorkers(signal?: AbortSignal) {
  return getJson<Worker[]>("/api/workers", { signal });
}

export function spawnWorker(type: Worker["type"]) {
  return sendJson<{ id: number }>("/api/workers", "POST", { type });
}

export function removeWorker(workerId: number) {
  return sendJson<{ ok: true }>(`/api/workers/${workerId}`, "DELETE");
}

export function killWorkerTask(workerId: number) {
  return sendJson<{ ok: true }>(`/api/workers/${workerId}/kill`, "POST");
}

export function getWorkerHistory(workerId: number, filename: string, signal?: AbortSignal) {
  return getJson<{ events: WorkerLogEvent[] }>(`/api/workers/${workerId}/history/${filename}`, { signal });
}

export function getWorkerRuns(date: string, signal?: AbortSignal) {
  return getJson<{ runs: RunEntry[] }>(`/api/workers/runs?date=${encodeURIComponent(date)}`, { signal });
}
