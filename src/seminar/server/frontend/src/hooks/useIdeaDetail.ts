import { useEffect, useRef } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getIdeaChildren,
  getIdeaContent,
  getIdeaInitialExpectation,
  getIdeaSources,
  getIdeaStudies,
} from "../api/ideas";
import { queryKeys } from "../realtime/queryKeys";
import { snapshotQueryOptions } from "./useSeminarStore";

function useStudyCounts() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.studyCounts,
    queryFn: async () => {
      const snapshot = await queryClient.ensureQueryData(snapshotQueryOptions(queryClient));
      return snapshot.study_counts;
    },
    staleTime: Infinity,
  });
}

export function useIdeaDetail(slug: string | null | undefined) {
  const queryClient = useQueryClient();
  const studyCountsQuery = useStudyCounts();
  const prevStudyCountRef = useRef<number | null>(null);
  const enabled = Boolean(slug);

  const [contentQuery, sourcesQuery, childrenQuery, initialExpectationQuery, studiesQuery] = useQueries({
    queries: [
      {
        queryKey: slug ? queryKeys.ideaContent(slug) : ["idea-content", "disabled"],
        queryFn: ({ signal }: { signal: AbortSignal }) => {
          if (!slug) throw new Error("Idea content requested without a slug");
          return getIdeaContent(slug, signal);
        },
        enabled,
        staleTime: Infinity,
      },
      {
        queryKey: slug ? queryKeys.ideaSources(slug) : ["idea-sources", "disabled"],
        queryFn: ({ signal }: { signal: AbortSignal }) => {
          if (!slug) throw new Error("Idea sources requested without a slug");
          return getIdeaSources(slug, signal);
        },
        enabled,
        staleTime: Infinity,
      },
      {
        queryKey: slug ? queryKeys.ideaChildren(slug) : ["idea-children", "disabled"],
        queryFn: ({ signal }: { signal: AbortSignal }) => {
          if (!slug) throw new Error("Idea children requested without a slug");
          return getIdeaChildren(slug, signal);
        },
        enabled,
        staleTime: Infinity,
      },
      {
        queryKey: slug ? queryKeys.ideaInitialExpectation(slug) : ["idea-initial-expectation", "disabled"],
        queryFn: ({ signal }: { signal: AbortSignal }) => {
          if (!slug) throw new Error("Initial expectation requested without a slug");
          return getIdeaInitialExpectation(slug, signal);
        },
        enabled,
        staleTime: Infinity,
      },
      {
        queryKey: slug ? queryKeys.ideaStudies(slug) : ["idea-studies", "disabled"],
        queryFn: ({ signal }: { signal: AbortSignal }) => {
          if (!slug) throw new Error("Idea studies requested without a slug");
          return getIdeaStudies(slug, signal);
        },
        enabled,
        staleTime: Infinity,
      },
    ],
  });

  useEffect(() => {
    if (!slug) {
      prevStudyCountRef.current = null;
      return;
    }
    const studyCounts = studyCountsQuery.data ?? {};
    const nextCount = studyCounts[slug] ?? 0;
    if (prevStudyCountRef.current != null && prevStudyCountRef.current !== nextCount) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.ideaStudies(slug) });
    }
    prevStudyCountRef.current = nextCount;
  }, [queryClient, slug, studyCountsQuery.data]);

  return {
    content: contentQuery.data?.content ?? null,
    title: contentQuery.data?.meta?.title ?? null,
    meta: contentQuery.data?.meta ?? null,
    sources: sourcesQuery.data ?? [],
    children: childrenQuery.data ?? [],
    initialExpectation: initialExpectationQuery.data ?? null,
    studies: studiesQuery.data ?? [],
    isLoading: contentQuery.isLoading,
  };
}
