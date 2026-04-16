import { useState, useEffect, useCallback, useRef } from "react";
import type { StudyFile } from "../types";

interface UseStudiesResult {
  studiesCache: Record<string, StudyFile[]>;
  fetchStudies: (slug: string) => void;
}

export function useStudies(studyCounts: Record<string, number>): UseStudiesResult {
  const [cache, setCache] = useState<Record<string, StudyFile[]>>({});
  const prevCounts = useRef<Record<string, number>>({});
  const subscribedSlugs = useRef<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevCounts.current;
    const toRefetch: string[] = [];
    for (const slug of subscribedSlugs.current) {
      if ((studyCounts[slug] ?? 0) !== (prev[slug] ?? 0)) {
        toRefetch.push(slug);
      }
    }
    prevCounts.current = { ...studyCounts };

    for (const slug of toRefetch) {
      fetch(`/api/ideas/${slug}/studies`)
        .then((r) => r.json())
        .then((data: StudyFile[]) =>
          setCache((c) => ({ ...c, [slug]: data }))
        )
        .catch(() => {});
    }
  }, [studyCounts]);

  const fetchStudies = useCallback((slug: string) => {
    subscribedSlugs.current.add(slug);
    fetch(`/api/ideas/${slug}/studies`)
      .then((r) => r.json())
      .then((data: StudyFile[]) =>
        setCache((c) => ({ ...c, [slug]: data }))
      )
      .catch(() => {});
  }, []);

  return { studiesCache: cache, fetchStudies };
}
