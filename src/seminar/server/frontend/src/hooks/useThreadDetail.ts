import { useQuery } from "@tanstack/react-query";
import { getThread } from "../api/threads";
import { queryKeys } from "../realtime/queryKeys";

export function useThreadDetail(id: number | null | undefined) {
  const enabled = id != null;
  const query = useQuery({
    queryKey: id != null ? queryKeys.thread(id) : ["thread", "disabled"],
    queryFn: ({ signal }) => {
      if (id == null) throw new Error("Thread detail requested without an id");
      return getThread(id, signal);
    },
    enabled,
    staleTime: Infinity,
  });

  return {
    threadDetail: query.data ?? null,
    isLoading: query.isLoading,
  };
}
