import type { Responder, ThreadDetail, ThreadSummary } from "../types";
import { getJson, sendJson } from "./client";

export interface CreateThreadInput {
  title: string;
  body: string;
  author_name: string;
  idea_slug?: string;
}

export interface ReplyToThreadInput {
  body: string;
  author_name: string;
}

export function listThreads(signal?: AbortSignal) {
  return getJson<ThreadSummary[]>("/api/threads", { signal });
}

export function listResponders(signal?: AbortSignal) {
  return getJson<Responder[]>("/api/responders", { signal });
}

export function getThread(id: number, signal?: AbortSignal) {
  return getJson<ThreadDetail>(`/api/threads/${id}`, { signal });
}

export function createThread(input: CreateThreadInput) {
  return sendJson<{ ok: true; id: number }>("/api/threads", "POST", input);
}

export function replyToThread(id: number, input: ReplyToThreadInput) {
  return sendJson<{ ok: true }>(`/api/threads/${id}/messages`, "POST", input);
}

export function closeThread(id: number) {
  return sendJson<{ ok: true }>(`/api/threads/${id}/close`, "POST");
}

export function deleteThread(id: number) {
  return sendJson<{ ok: true }>(`/api/threads/${id}`, "DELETE");
}
