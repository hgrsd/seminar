import type { Proposal } from "../types";
import { getJson, sendJson } from "./client";

export interface ProposalContentResponse {
  content: string;
  meta: Record<string, string> | null;
}

export function listProposals(signal?: AbortSignal) {
  return getJson<Proposal[]>("/api/proposals", { signal });
}

export function getProposalContent(slug: string, signal?: AbortSignal) {
  return getJson<ProposalContentResponse>(`/api/proposals/${slug}/content`, { signal });
}

export function approveProposal(slug: string) {
  return sendJson<{ ok: true; slug: string }>(`/api/proposals/${slug}/approve`, "POST");
}

export function rejectProposal(slug: string) {
  return sendJson<{ ok: true }>(`/api/proposals/${slug}/reject`, "POST");
}

export function deleteProposal(slug: string) {
  return sendJson<{ ok: true }>(`/api/proposals/${slug}`, "DELETE");
}
