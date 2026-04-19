import { useSeminarActions, useSeminarState } from "./useSeminarStore";

export function useThreads() {
  const { threads, responders } = useSeminarState();
  const { createThread, getThread, replyToThread, closeThread, deleteThread } = useSeminarActions();
  return { threads, responders, createThread, getThread, replyToThread, closeThread, deleteThread };
}
