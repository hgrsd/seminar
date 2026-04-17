import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ActivityEvent,
  Idea,
  Proposal,
  Settings,
  SnapshotState,
  Worker,
  WSMessage,
} from "../types";

interface SeminarState {
  ideas: Idea[];
  workers: Worker[];
  activity: ActivityEvent[];
  studyCounts: Record<string, number>;
  proposals: Proposal[];
  paused: boolean;
  sessionCost: number;
  connected: boolean;
}

interface SeminarActions {
  createIdea: (input: {
    title: string;
    slug: string;
    author?: string;
    body: string;
    initial_expectation?: string;
  }) => Promise<void>;
  markIdeaDone: (slug: string) => Promise<void>;
  reopenIdea: (slug: string) => Promise<void>;
  resetIdea: (slug: string) => Promise<void>;
  deleteIdea: (slug: string) => Promise<void>;
  addDirectorNote: (slug: string, body: string) => Promise<void>;
  approveProposal: (slug: string) => Promise<void>;
  rejectProposal: (slug: string) => Promise<void>;
  deleteProposal: (slug: string) => Promise<void>;
  spawnWorker: (type: "initial_exploration" | "follow_up_research" | "connective_research") => Promise<void>;
  removeWorker: (workerId: number) => Promise<void>;
  killWorkerTask: (workerId: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  getSettings: (signal?: AbortSignal) => Promise<Settings>;
  updateSettings: (input: Omit<Settings, "available_providers">) => Promise<Settings>;
  getProviderDefaults: (signal?: AbortSignal) => Promise<Record<string, { default_cmd: string }>>;
}

const MAX_ACTIVITY = 100;

const initialState: SeminarState = {
  ideas: [],
  workers: [],
  activity: [],
  studyCounts: {},
  proposals: [],
  paused: true,
  sessionCost: 0,
  connected: false,
};

const SeminarStateContext = createContext<SeminarState | null>(null);
const SeminarActionsContext = createContext<SeminarActions | null>(null);

function upsertByKey<T, K extends keyof T>(items: T[], item: T, key: K): T[] {
  const idx = items.findIndex((entry) => entry[key] === item[key]);
  if (idx === -1) return [...items, item];
  const next = items.slice();
  next[idx] = item;
  return next;
}

function sortIdeas(ideas: Idea[]): Idea[] {
  return [...ideas].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
}

function sortProposals(proposals: Proposal[]): Proposal[] {
  return [...proposals].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
}

function sortWorkers(workers: Worker[]): Worker[] {
  return [...workers].sort((a, b) => a.id - b.id);
}

function fromSnapshot(snapshot: SnapshotState, connected: boolean): SeminarState {
  return {
    ideas: sortIdeas(snapshot.ideas),
    workers: sortWorkers(snapshot.workers),
    activity: snapshot.activity,
    studyCounts: snapshot.study_counts,
    proposals: sortProposals(snapshot.proposals),
    paused: snapshot.paused,
    sessionCost: snapshot.session_cost,
    connected,
  };
}

function reduceState(state: SeminarState, msg: WSMessage): SeminarState {
  switch (msg.type) {
    case "snapshot":
      return fromSnapshot(msg.data, state.connected);
    case "activity_logged":
      return {
        ...state,
        activity: [msg.data, ...state.activity].slice(0, MAX_ACTIVITY),
      };
    case "idea_upserted":
      return {
        ...state,
        ideas: sortIdeas(upsertByKey(state.ideas, msg.data, "slug")),
      };
    case "idea_deleted":
      return {
        ...state,
        ideas: state.ideas.filter((idea) => idea.slug !== msg.data.slug),
      };
    case "proposal_upserted":
      return {
        ...state,
        proposals: sortProposals(upsertByKey(state.proposals, msg.data, "slug")),
      };
    case "proposal_deleted":
      return {
        ...state,
        proposals: state.proposals.filter((proposal) => proposal.slug !== msg.data.slug),
      };
    case "worker_upserted":
      return {
        ...state,
        workers: sortWorkers(upsertByKey(state.workers, msg.data, "id")),
      };
    case "worker_removed":
      return {
        ...state,
        workers: state.workers.filter((worker) => worker.id !== msg.data.id),
      };
    case "study_count_updated": {
      const next = { ...state.studyCounts };
      if (msg.data.count > 0) next[msg.data.slug] = msg.data.count;
      else delete next[msg.data.slug];
      return { ...state, studyCounts: next };
    }
    case "study_counts_replaced":
      return { ...state, studyCounts: msg.data };
    case "paused_changed":
      return { ...state, paused: msg.data };
    case "session_cost_changed":
      return { ...state, sessionCost: msg.data };
    default:
      return state;
  }
}

async function apiRequest(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response;
}

export function SeminarProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduceState, initialState);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (mountedRef.current) setConnected(true);
    };
    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 2000);
    };
    ws.onerror = () => {
      ws.close();
    };
    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg: WSMessage = JSON.parse(event.data);
        dispatch(msg);
      } catch {
        // ignore malformed messages
      }
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const createIdea = useCallback(async (input: {
    title: string;
    slug: string;
    author?: string;
    body: string;
    initial_expectation?: string;
  }) => {
    await apiRequest("/api/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        slug: input.slug,
        author: input.author ?? "",
        body: input.body,
        initial_expectation: input.initial_expectation?.trim() || undefined,
      }),
    });
  }, []);

  const markIdeaDone = useCallback(async (slug: string) => {
    await apiRequest(`/api/ideas/${slug}/done`, { method: "POST" });
  }, []);

  const reopenIdea = useCallback(async (slug: string) => {
    await apiRequest(`/api/ideas/${slug}/reopen`, { method: "POST" });
  }, []);

  const resetIdea = useCallback(async (slug: string) => {
    await apiRequest(`/api/ideas/${slug}/reset`, { method: "POST" });
  }, []);

  const deleteIdea = useCallback(async (slug: string) => {
    await apiRequest(`/api/ideas/${slug}`, { method: "DELETE" });
  }, []);

  const addDirectorNote = useCallback(async (slug: string, body: string) => {
    await apiRequest(`/api/ideas/${slug}/director-note`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
  }, []);

  const approveProposal = useCallback(async (slug: string) => {
    await apiRequest(`/api/proposals/${slug}/approve`, { method: "POST" });
  }, []);

  const rejectProposal = useCallback(async (slug: string) => {
    await apiRequest(`/api/proposals/${slug}/reject`, { method: "POST" });
  }, []);

  const deleteProposal = useCallback(async (slug: string) => {
    await apiRequest(`/api/proposals/${slug}`, { method: "DELETE" });
  }, []);

  const spawnWorker = useCallback(async (type: "initial_exploration" | "follow_up_research" | "connective_research") => {
    await apiRequest("/api/workers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
  }, []);

  const removeWorker = useCallback(async (workerId: number) => {
    await apiRequest(`/api/workers/${workerId}`, { method: "DELETE" });
  }, []);

  const killWorkerTask = useCallback(async (workerId: number) => {
    await apiRequest(`/api/workers/${workerId}/kill`, { method: "POST" });
  }, []);

  const pause = useCallback(async () => {
    await apiRequest("/api/pause", { method: "POST" });
  }, []);

  const resume = useCallback(async () => {
    await apiRequest("/api/resume", { method: "POST" });
  }, []);

  const getSettings = useCallback(async (signal?: AbortSignal) => {
    const response = await apiRequest("/api/settings", { signal });
    return response.json() as Promise<Settings>;
  }, []);

  const updateSettings = useCallback(async (input: Omit<Settings, "available_providers">) => {
    const response = await apiRequest("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return response.json() as Promise<Settings>;
  }, []);

  const getProviderDefaults = useCallback(async (signal?: AbortSignal) => {
    const response = await apiRequest("/api/providers", { signal });
    return response.json() as Promise<Record<string, { default_cmd: string }>>;
  }, []);

  const actions = useMemo<SeminarActions>(() => ({
    createIdea,
    markIdeaDone,
    reopenIdea,
    resetIdea,
    deleteIdea,
    addDirectorNote,
    approveProposal,
    rejectProposal,
    deleteProposal,
    spawnWorker,
    removeWorker,
    killWorkerTask,
    pause,
    resume,
    getSettings,
    updateSettings,
    getProviderDefaults,
  }), [
    addDirectorNote,
    approveProposal,
    createIdea,
    deleteIdea,
    deleteProposal,
    killWorkerTask,
    markIdeaDone,
    pause,
    rejectProposal,
    removeWorker,
    reopenIdea,
    resetIdea,
    resume,
    spawnWorker,
    getSettings,
    updateSettings,
    getProviderDefaults,
  ]);

  const stateValue = useMemo(
    () => ({ ...state, connected }),
    [state, connected],
  );

  return (
    <SeminarStateContext.Provider value={stateValue}>
      <SeminarActionsContext.Provider value={actions}>
        {children}
      </SeminarActionsContext.Provider>
    </SeminarStateContext.Provider>
  );
}

export function useSeminarState() {
  const context = useContext(SeminarStateContext);
  if (!context) throw new Error("SeminarProvider missing");
  return context;
}

export function useSeminarActions() {
  const context = useContext(SeminarActionsContext);
  if (!context) throw new Error("SeminarProvider missing");
  return context;
}
