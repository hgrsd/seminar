import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { getIdeaStudies } from "../api/ideas";
import { queryKeys } from "../realtime/queryKeys";
import type { StudyFile } from "../types";

interface UseStudiesResult {
  studiesCache: Record<string, StudyFile[]>;
  fetchStudies: (slug: string) => void;
}

export function useStudies(studyCounts: Record<string, number>): UseStudiesResult {
  const queryClient = useQueryClient();
  const [subscribedSlugs, setSubscribedSlugs] = useState<string[]>([]);
  const prevCounts = useRef<Record<string, number>>({});

  const studyQueries = useQueries({
    queries: subscribedSlugs.map((slug) => ({
      queryKey: queryKeys.ideaStudies(slug),
      queryFn: ({ signal }: { signal: AbortSignal }) => getIdeaStudies(slug, signal),
      staleTime: Infinity,
    })),
  });

  useEffect(() => {
    const prev = prevCounts.current;
    for (const slug of subscribedSlugs) {
      if ((studyCounts[slug] ?? 0) !== (prev[slug] ?? 0)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ideaStudies(slug) });
      }
    }
    prevCounts.current = { ...studyCounts };
  }, [queryClient, studyCounts, subscribedSlugs]);

  const fetchStudies = useCallback((slug: string) => {
    setSubscribedSlugs((current) => (current.includes(slug) ? current : [...current, slug]));
    void queryClient.prefetchQuery({
      queryKey: queryKeys.ideaStudies(slug),
      queryFn: ({ signal }) => getIdeaStudies(slug, signal),
      staleTime: Infinity,
    });
  }, [queryClient]);

  const studiesCache = useMemo(() => {
    const next: Record<string, StudyFile[]> = {};
    for (const [index, slug] of subscribedSlugs.entries()) {
      next[slug] = studyQueries[index]?.data ?? [];
    }
    return next;
  }, [studyQueries, subscribedSlugs]);

  return { studiesCache, fetchStudies };
}
