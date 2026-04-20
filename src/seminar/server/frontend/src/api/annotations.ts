import type { Annotation } from "../types";
import { getJson, sendJson } from "./client";

export interface CreateAnnotationInput {
  rendered_text_start_offset: number;
  rendered_text_end_offset: number;
  rendered_text: string;
  body: string;
}

export function listAnnotations(slug: string, studyNumber: number, signal?: AbortSignal) {
  return getJson<Annotation[]>(`/api/ideas/${slug}/studies/${studyNumber}/annotations`, { signal });
}

export function createAnnotation(slug: string, studyNumber: number, input: CreateAnnotationInput) {
  return sendJson<Annotation>(`/api/ideas/${slug}/studies/${studyNumber}/annotations`, "POST", input);
}

export function updateAnnotation(annotationId: number, body: string) {
  return sendJson<Annotation>(`/api/annotations/${annotationId}`, "PUT", { body });
}

export function deleteAnnotation(annotationId: number) {
  return sendJson<{ ok: true }>(`/api/annotations/${annotationId}`, "DELETE");
}
