import { useSeminarState } from "./useSeminarStore";

export function useActivity() {
  const { activity } = useSeminarState();
  return { activity };
}
