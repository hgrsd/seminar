import { type ReactNode, useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { RealtimeProvider, useRealtimeState } from "../realtime/RealtimeProvider";
import { seedSnapshot } from "../realtime/applyWsMessage";
import { queryKeys } from "../realtime/queryKeys";
import * as ideasApi from "../api/ideas";
import * as proposalsApi from "../api/proposals";
import * as threadsApi from "../api/threads";
import * as workersApi from "../api/workers";
import * as systemApi from "../api/system";
import type { Settings } from "../types";

export function SeminarProvider({ children }: { children: ReactNode }) {
  return <RealtimeProvider>{children}</RealtimeProvider>;
}

function useSeededSnapshotQuery() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.snapshot,
    queryFn: async () => {
      const snapshot = await systemApi.getSnapshot();
      seedSnapshot(queryClient, snapshot);
      return snapshot;
    },
    staleTime: Infinity,
  });
}

export function useSeminarState() {
  const queryClient = useQueryClient();
  const snapshotQuery = useSeededSnapshotQuery();
  const realtime = useRealtimeState();
  const snapshot = snapshotQuery.data;

  return useMemo(() => ({
    ideas: snapshot?.ideas ?? queryClient.getQueryData(queryKeys.ideas) ?? [],
    workers: snapshot?.workers ?? queryClient.getQueryData(queryKeys.workers) ?? [],
    activity: realtime.activity,
    studyCounts: snapshot?.study_counts ?? queryClient.getQueryData(queryKeys.studyCounts) ?? {},
    proposals: snapshot?.proposals ?? queryClient.getQueryData(queryKeys.proposals) ?? [],
    threads: snapshot?.threads ?? queryClient.getQueryData(queryKeys.threads) ?? [],
    responders: snapshot?.responders ?? queryClient.getQueryData(queryKeys.responders) ?? [],
    paused: realtime.paused,
    sessionCost: realtime.sessionCost,
    connected: realtime.connected,
  }), [
    queryClient,
    realtime.activity,
    realtime.connected,
    realtime.paused,
    realtime.sessionCost,
    snapshot,
  ]);
}

export function useSeminarActions() {
  const queryClient = useQueryClient();

  const createIdea = useMutation({ mutationFn: ideasApi.createIdea });
  const markIdeaDone = useMutation({ mutationFn: ({ slug, threadId }: { slug: string; threadId?: number }) => ideasApi.markIdeaDone(slug, threadId) });
  const reopenIdea = useMutation({ mutationFn: ({ slug, threadId }: { slug: string; threadId?: number }) => ideasApi.reopenIdea(slug, threadId) });
  const resetIdea = useMutation({ mutationFn: ideasApi.resetIdea });
  const deleteIdea = useMutation({ mutationFn: ideasApi.deleteIdea });
  const addDirectorNote = useMutation({
    mutationFn: ({ slug, body, threadId }: { slug: string; body: string; threadId?: number }) =>
      ideasApi.addDirectorNote(slug, body, threadId),
  });

  const approveProposal = useMutation({ mutationFn: proposalsApi.approveProposal });
  const rejectProposal = useMutation({ mutationFn: proposalsApi.rejectProposal });
  const deleteProposal = useMutation({ mutationFn: proposalsApi.deleteProposal });

  const createThread = useMutation({ mutationFn: threadsApi.createThread });
  const replyToThread = useMutation({
    mutationFn: ({ id, input }: { id: number; input: threadsApi.ReplyToThreadInput }) =>
      threadsApi.replyToThread(id, input),
  });
  const closeThread = useMutation({ mutationFn: threadsApi.closeThread });
  const deleteThread = useMutation({ mutationFn: threadsApi.deleteThread });

  const spawnWorker = useMutation({ mutationFn: workersApi.spawnWorker });
  const removeWorker = useMutation({ mutationFn: workersApi.removeWorker });
  const killWorkerTask = useMutation({ mutationFn: workersApi.killWorkerTask });

  const pause = useMutation({ mutationFn: systemApi.pauseFleet });
  const resume = useMutation({ mutationFn: systemApi.resumeFleet });
  const updateSettings = useMutation({
    mutationFn: systemApi.updateSettings,
    onSuccess(next) {
      queryClient.setQueryData(queryKeys.settings, next);
    },
  });

  return useMemo(() => ({
    createIdea: async (input: ideasApi.CreateIdeaInput) => createIdea.mutateAsync(input).then(() => undefined),
    markIdeaDone: async (slug: string, threadId?: number) => markIdeaDone.mutateAsync({ slug, threadId }).then(() => undefined),
    reopenIdea: async (slug: string, threadId?: number) => reopenIdea.mutateAsync({ slug, threadId }).then(() => undefined),
    resetIdea: async (slug: string) => resetIdea.mutateAsync(slug).then(() => undefined),
    deleteIdea: async (slug: string) => deleteIdea.mutateAsync(slug).then(() => undefined),
    addDirectorNote: async (slug: string, body: string, threadId?: number) =>
      addDirectorNote.mutateAsync({ slug, body, threadId }).then(() => undefined),
    approveProposal: async (slug: string) => approveProposal.mutateAsync(slug).then(() => undefined),
    rejectProposal: async (slug: string) => rejectProposal.mutateAsync(slug).then(() => undefined),
    deleteProposal: async (slug: string) => deleteProposal.mutateAsync(slug).then(() => undefined),
    createThread: async (input: threadsApi.CreateThreadInput) => createThread.mutateAsync(input).then(() => undefined),
    getThread: (id: number, signal?: AbortSignal) => threadsApi.getThread(id, signal),
    replyToThread: async (id: number, input: threadsApi.ReplyToThreadInput) =>
      replyToThread.mutateAsync({ id, input }).then(() => undefined),
    closeThread: async (id: number) => closeThread.mutateAsync(id).then(() => undefined),
    deleteThread: async (id: number) => deleteThread.mutateAsync(id).then(() => undefined),
    spawnWorker: async (type: "initial_exploration" | "follow_up_research" | "connective_research") =>
      spawnWorker.mutateAsync(type).then(() => undefined),
    removeWorker: async (workerId: number) => removeWorker.mutateAsync(workerId).then(() => undefined),
    killWorkerTask: async (workerId: number) => killWorkerTask.mutateAsync(workerId).then(() => undefined),
    pause: async () => pause.mutateAsync().then(() => undefined),
    resume: async () => resume.mutateAsync().then(() => undefined),
    getSettings: (signal?: AbortSignal) => systemApi.getSettings(signal),
    updateSettings: (input: Omit<Settings, "available_providers">) => updateSettings.mutateAsync(input),
    getProviderDefaults: (signal?: AbortSignal) => systemApi.getProviderDefaults(signal),
  }), [
    addDirectorNote,
    approveProposal,
    closeThread,
    createIdea,
    createThread,
    deleteIdea,
    deleteProposal,
    deleteThread,
    killWorkerTask,
    markIdeaDone,
    pause,
    removeWorker,
    reopenIdea,
    replyToThread,
    resetIdea,
    resume,
    spawnWorker,
    updateSettings,
  ]);
}
