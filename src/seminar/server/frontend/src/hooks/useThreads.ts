import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Responder, ThreadSummary } from "../types";
import { queryKeys } from "../realtime/queryKeys";
import { snapshotQueryOptions, useSeminarActions } from "./useSeminarStore";

export function useThreads() {
  const queryClient = useQueryClient();
  const threadsQuery = useQuery({
    queryKey: queryKeys.threads,
    queryFn: async () => {
      const snapshot = await queryClient.ensureQueryData(snapshotQueryOptions(queryClient));
      return queryClient.getQueryData<ThreadSummary[]>(queryKeys.threads) ?? snapshot.threads;
    },
    staleTime: Infinity,
  });
  const respondersQuery = useQuery({
    queryKey: queryKeys.responders,
    queryFn: async () => {
      const snapshot = await queryClient.ensureQueryData(snapshotQueryOptions(queryClient));
      return queryClient.getQueryData<Responder[]>(queryKeys.responders) ?? snapshot.responders;
    },
    staleTime: Infinity,
  });
  const { createThread, getThread, replyToThread, closeThread, deleteThread } = useSeminarActions();
  return {
    threads: threadsQuery.data ?? [],
    responders: respondersQuery.data ?? [],
    createThread,
    getThread,
    replyToThread,
    closeThread,
    deleteThread,
  };
}
