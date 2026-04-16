import { useMemo } from "react";
import type { Worker } from "../types";

export function useActiveWorkers(workers: Worker[]): Map<string, Worker> {
  return useMemo(() => {
    const map = new Map<string, Worker>();
    for (const w of workers) {
      if (w.current_slug) map.set(w.current_slug, w);
    }
    return map;
  }, [workers]);
}
