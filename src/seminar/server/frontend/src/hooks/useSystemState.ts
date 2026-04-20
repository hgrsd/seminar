import { useRealtimeState } from "../realtime/RealtimeProvider";
import { useSeminarActions } from "./useSeminarStore";

export function useSystemState() {
  const { paused, sessionCost, connected } = useRealtimeState();
  const { pause, resume, getSettings, updateSettings, getProviderDefaults } = useSeminarActions();

  return {
    paused,
    sessionCost,
    connected,
    pause,
    resume,
    getSettings,
    updateSettings,
    getProviderDefaults,
  };
}
