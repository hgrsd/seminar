import { useSeminarActions, useSeminarState } from "./useSeminarStore";

export function useSystemState() {
  const { paused, sessionCost, connected } = useSeminarState();
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
