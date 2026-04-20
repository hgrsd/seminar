import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Worker } from "../types";
import { queryKeys } from "../realtime/queryKeys";
import { snapshotQueryOptions, useSeminarActions } from "./useSeminarStore";

export function useWorkers() {
  const queryClient = useQueryClient();
  const workersQuery = useQuery({
    queryKey: queryKeys.workers,
    queryFn: async () => {
      const snapshot = await queryClient.ensureQueryData(snapshotQueryOptions(queryClient));
      return queryClient.getQueryData<Worker[]>(queryKeys.workers) ?? snapshot.workers;
    },
    staleTime: Infinity,
  });
  const { spawnWorker, removeWorker, killWorkerTask } = useSeminarActions();

  return {
    workers: workersQuery.data ?? [],
    spawnWorker,
    removeWorker,
    killWorkerTask,
  };
}
