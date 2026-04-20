import type { Settings, SnapshotState } from "../types";
import { getJson, sendJson } from "./client";

export interface ProviderDefaults {
  [provider: string]: { default_cmd: string };
}

export interface SearchResult {
  type: "idea" | "study" | "proposal" | "annotation" | "thread";
  slug: string | null;
  title: string;
  snippet: string;
  study_number?: number;
  annotation_id?: number;
  thread_id?: number;
}

export function getSnapshot(signal?: AbortSignal) {
  return getJson<SnapshotState>("/api/snapshot", { signal });
}

export function search(q: string, signal?: AbortSignal) {
  return getJson<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`, { signal });
}

export function pauseFleet() {
  return sendJson<{ ok: true }>("/api/pause", "POST");
}

export function resumeFleet() {
  return sendJson<{ ok: true }>("/api/resume", "POST");
}

export function getSettings(signal?: AbortSignal) {
  return getJson<Settings>("/api/settings", { signal });
}

export function updateSettings(input: Omit<Settings, "available_providers">) {
  return getJson<Settings>("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getProviderDefaults(signal?: AbortSignal) {
  return getJson<ProviderDefaults>("/api/providers", { signal });
}
