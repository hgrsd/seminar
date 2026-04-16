import { useSeminarActions, useSeminarState } from "./useSeminarStore";

export function useSystemState() {
  const { paused, sessionCost, connected } = useSeminarState();
  const { pause, resume } = useSeminarActions();

  return {
    paused,
    sessionCost,
    connected,
    pause,
    resume,
  };
}
