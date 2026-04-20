import type { InitialExpectation, StudyFile, ThreadSummary } from "../types";
import { getJson, getText, sendJson } from "./client";

export interface IdeaContentResponse {
  content: string;
  meta: Record<string, string> | null;
}

export interface IdeaRelation {
  slug: string;
  title: string;
}

export interface CreateIdeaInput {
  title: string;
  slug: string;
  author?: string;
  body: string;
  initial_expectation?: string;
}

export function getIdeaContent(slug: string, signal?: AbortSignal) {
  return getJson<IdeaContentResponse>(`/api/ideas/${slug}/content`, { signal });
}

export function getIdeaInitialExpectation(slug: string, signal?: AbortSignal) {
  return getJson<InitialExpectation>(`/api/ideas/${slug}/initial-expectation`, { signal });
}

export function getIdeaStudies(slug: string, signal?: AbortSignal) {
  return getJson<StudyFile[]>(`/api/ideas/${slug}/studies`, { signal });
}

export function getIdeaSources(slug: string, signal?: AbortSignal) {
  return getJson<IdeaRelation[]>(`/api/ideas/${slug}/sources`, { signal });
}

export function getIdeaChildren(slug: string, signal?: AbortSignal) {
  return getJson<IdeaRelation[]>(`/api/ideas/${slug}/children`, { signal });
}

export function getIdeaThreads(slug: string, signal?: AbortSignal) {
  return getJson<ThreadSummary[]>(`/api/ideas/${slug}/threads`, { signal });
}

export function exportIdea(slug: string, signal?: AbortSignal) {
  return getText(`/api/ideas/${slug}/export`, { signal });
}

export function createIdea(input: CreateIdeaInput) {
  return sendJson<{ ok: true; slug: string }>("/api/ideas", "POST", {
    title: input.title,
    slug: input.slug,
    author: input.author ?? "",
    body: input.body,
    initial_expectation: input.initial_expectation?.trim() || undefined,
  });
}

export function markIdeaDone(slug: string, threadId?: number) {
  return sendJson<{ ok: true }>(`/api/ideas/${slug}/done`, "POST", threadId ? { thread_id: threadId } : undefined);
}

export function reopenIdea(slug: string, threadId?: number) {
  return sendJson<{ ok: true }>(`/api/ideas/${slug}/reopen`, "POST", threadId ? { thread_id: threadId } : undefined);
}

export function resetIdea(slug: string) {
  return sendJson<{ ok: true }>(`/api/ideas/${slug}/reset`, "POST");
}

export function deleteIdea(slug: string) {
  return sendJson<{ ok: true }>(`/api/ideas/${slug}`, "DELETE");
}

export function addDirectorNote(slug: string, body: string, threadId?: number) {
  return sendJson<{ ok: true; study_number: number }>(`/api/ideas/${slug}/director-note`, "POST", {
    body,
    thread_id: threadId,
  });
}
