import type { QueryClient } from "@tanstack/react-query";
import type {
  ActivityEvent,
  Idea,
  Proposal,
  SnapshotState,
  ThreadDetail,
  ThreadSummary,
  Worker,
  WSMessage,
} from "../types";
import { queryKeys } from "./queryKeys";

interface RealtimeSetters {
  setActivity: (updater: (current: ActivityEvent[]) => ActivityEvent[]) => void;
  setPaused: (paused: boolean) => void;
  setSessionCost: (value: number) => void;
  applySnapshotRealtime: (snapshot: SnapshotState) => void;
}

function upsertById<T extends { id: number }>(items: T[], item: T): T[] {
  const index = items.findIndex((entry) => entry.id === item.id);
  if (index === -1) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
}

function upsertBySlug<T extends { slug: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((entry) => entry.slug === item.slug);
  if (index === -1) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
}

function removeById<T extends { id: number }>(items: T[], id: number): T[] {
  return items.filter((entry) => entry.id !== id);
}

function removeBySlug<T extends { slug: string }>(items: T[], slug: string): T[] {
  return items.filter((entry) => entry.slug !== slug);
}

function sortIdeas<T extends { recorded_at: string }>(items: T[]) {
  return [...items].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
}

function sortThreads<T extends { updated_at: string }>(items: T[]) {
  return [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

function sortWorkers(items: Worker[]) {
  return [...items].sort((a, b) => a.id - b.id);
}

function patchThreadSummary(threads: ThreadSummary[], summary: ThreadSummary) {
  return sortThreads(upsertById(threads, summary));
}

function patchThreadDetail(existing: ThreadDetail | undefined, summary: ThreadSummary): ThreadDetail | undefined {
  if (!existing) return existing;
  return { ...existing, ...summary };
}

export function seedSnapshot(queryClient: QueryClient, snapshot: SnapshotState) {
  queryClient.setQueryData(queryKeys.snapshot, snapshot);
  queryClient.setQueryData(queryKeys.ideas, sortIdeas(snapshot.ideas));
  queryClient.setQueryData(queryKeys.studyCounts, snapshot.study_counts);
  queryClient.setQueryData(queryKeys.proposals, snapshot.proposals);
  queryClient.setQueryData(queryKeys.threads, sortThreads(snapshot.threads));
  queryClient.setQueryData(queryKeys.workers, sortWorkers(snapshot.workers));
  queryClient.setQueryData(queryKeys.responders, snapshot.responders);

  for (const idea of snapshot.ideas) {
    queryClient.setQueryData(queryKeys.idea(idea.slug), idea);
  }
  for (const proposal of snapshot.proposals) {
    queryClient.setQueryData(queryKeys.proposal(proposal.slug), proposal);
  }
  for (const worker of snapshot.workers) {
    queryClient.setQueryData(queryKeys.worker(worker.id), worker);
  }
}

export function applyWsMessage(
  queryClient: QueryClient,
  message: WSMessage,
  realtime: RealtimeSetters,
) {
  switch (message.type) {
    case "snapshot":
      seedSnapshot(queryClient, message.data);
      realtime.applySnapshotRealtime(message.data);
      return;
    case "activity_logged":
      realtime.setActivity((current) => [message.data, ...current].slice(0, 100));
      return;
    case "idea_upserted":
      queryClient.setQueryData(queryKeys.ideas, (current: Idea[] | undefined) =>
        sortIdeas(upsertBySlug(current ?? [], message.data)),
      );
      queryClient.setQueryData(queryKeys.idea(message.data.slug), message.data);
      return;
    case "idea_deleted":
      queryClient.setQueryData(queryKeys.ideas, (current: Idea[] | undefined) =>
        removeBySlug(current ?? [], message.data.slug),
      );
      queryClient.removeQueries({ queryKey: queryKeys.idea(message.data.slug) });
      queryClient.removeQueries({ queryKey: queryKeys.ideaContent(message.data.slug) });
      queryClient.removeQueries({ queryKey: queryKeys.ideaStudies(message.data.slug) });
      queryClient.removeQueries({ queryKey: queryKeys.ideaSources(message.data.slug) });
      queryClient.removeQueries({ queryKey: queryKeys.ideaChildren(message.data.slug) });
      queryClient.removeQueries({ queryKey: queryKeys.ideaInitialExpectation(message.data.slug) });
      return;
    case "proposal_upserted":
      queryClient.setQueryData(queryKeys.proposals, (current: Proposal[] | undefined) =>
        upsertBySlug(current ?? [], message.data),
      );
      queryClient.setQueryData(queryKeys.proposal(message.data.slug), message.data);
      return;
    case "proposal_deleted":
      queryClient.setQueryData(queryKeys.proposals, (current: Proposal[] | undefined) =>
        removeBySlug(current ?? [], message.data.slug),
      );
      queryClient.removeQueries({ queryKey: queryKeys.proposal(message.data.slug) });
      queryClient.removeQueries({ queryKey: queryKeys.proposalContent(message.data.slug) });
      return;
    case "thread_upserted":
      queryClient.setQueryData(queryKeys.threads, (current: ThreadSummary[] | undefined) =>
        patchThreadSummary(current ?? [], message.data),
      );
      queryClient.setQueryData(queryKeys.thread(message.data.id), (current: ThreadDetail | undefined) =>
        current ? patchThreadDetail(current, message.data) : current,
      );
      if (message.data.idea_slug) {
        queryClient.invalidateQueries({ queryKey: queryKeys.ideaThreads(message.data.idea_slug) });
      }
      return;
    case "thread_deleted":
      queryClient.setQueryData(queryKeys.threads, (current: ThreadSummary[] | undefined) =>
        removeById(current ?? [], message.data.id),
      );
      queryClient.removeQueries({ queryKey: queryKeys.thread(message.data.id) });
      return;
    case "thread_message_added":
      queryClient.setQueryData(queryKeys.thread(message.data.thread_id), (current: ThreadDetail | undefined) => {
        if (!current) return current;
        const alreadyPresent = current.messages.some((messageItem) => messageItem.id === message.data.id);
        if (alreadyPresent) return current;
        return { ...current, messages: [...current.messages, message.data] };
      });
      return;
    case "worker_upserted":
      queryClient.setQueryData(queryKeys.workers, (current: Worker[] | undefined) =>
        sortWorkers(upsertById(current ?? [], message.data)),
      );
      queryClient.setQueryData(queryKeys.worker(message.data.id), message.data);
      return;
    case "worker_removed":
      queryClient.setQueryData(queryKeys.workers, (current: Worker[] | undefined) =>
        removeById(current ?? [], message.data.id),
      );
      queryClient.removeQueries({ queryKey: queryKeys.worker(message.data.id) });
      return;
    case "study_count_updated":
      queryClient.setQueryData(
        queryKeys.studyCounts,
        (current: Record<string, number> | undefined) => {
          const next = { ...(current ?? {}) };
          if (message.data.count > 0) next[message.data.slug] = message.data.count;
          else delete next[message.data.slug];
          return next;
        },
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.ideaStudies(message.data.slug) });
      return;
    case "study_counts_replaced":
      queryClient.setQueryData(queryKeys.studyCounts, message.data);
      return;
    case "paused_changed":
      realtime.setPaused(message.data);
      return;
    case "session_cost_changed":
      realtime.setSessionCost(message.data);
      return;
  }
}
