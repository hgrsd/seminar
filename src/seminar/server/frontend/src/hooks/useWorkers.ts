import { useSeminarActions, useSeminarState } from "./useSeminarStore";

export function useWorkers() {
  const { workers } = useSeminarState();
  const { spawnWorker, removeWorker, killWorkerTask } = useSeminarActions();

  return {
    workers,
    spawnWorker,
    removeWorker,
    killWorkerTask,
  };
}
