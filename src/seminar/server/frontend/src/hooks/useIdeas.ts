import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Idea } from "../types";
import { queryKeys } from "../realtime/queryKeys";
import { snapshotQueryOptions, useSeminarActions } from "./useSeminarStore";

function useIdeasQuery() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.ideas,
    queryFn: async () => {
      const snapshot = await queryClient.ensureQueryData(snapshotQueryOptions(queryClient));
      return queryClient.getQueryData<Idea[]>(queryKeys.ideas) ?? snapshot.ideas;
    },
    staleTime: Infinity,
  });
}

function useStudyCountsQuery() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.studyCounts,
    queryFn: async () => {
      const snapshot = await queryClient.ensureQueryData(snapshotQueryOptions(queryClient));
      return queryClient.getQueryData<Record<string, number>>(queryKeys.studyCounts) ?? snapshot.study_counts;
    },
    staleTime: Infinity,
  });
}

export function useIdeas() {
  const ideasQuery = useIdeasQuery();
  const studyCountsQuery = useStudyCountsQuery();
  const {
    createIdea,
    markIdeaDone,
    reopenIdea,
    resetIdea,
    deleteIdea,
    addDirectorNote,
  } = useSeminarActions();

  return {
    ideas: ideasQuery.data ?? [],
    studyCounts: studyCountsQuery.data ?? {},
    createIdea,
    markIdeaDone,
    reopenIdea,
    resetIdea,
    deleteIdea,
    addDirectorNote,
  };
}
