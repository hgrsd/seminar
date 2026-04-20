import { useRealtimeState } from "../realtime/RealtimeProvider";

export function useActivity() {
  const { activity } = useRealtimeState();
  return { activity };
}
