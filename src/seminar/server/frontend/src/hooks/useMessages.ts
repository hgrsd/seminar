import { useSeminarActions, useSeminarState } from "./useSeminarStore";

export function useMessages() {
  const { messages } = useSeminarState();
  const { getMessageContent, markMessageRead, deleteMessage } = useSeminarActions();
  return { messages, getMessageContent, markMessageRead, deleteMessage };
}
