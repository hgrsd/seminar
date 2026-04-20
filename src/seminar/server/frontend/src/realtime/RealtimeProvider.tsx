import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActivityEvent, WSMessage } from "../types";
import { applyWsMessage, seedSnapshot } from "./applyWsMessage";
import { snapshotQueryOptions } from "../hooks/useSeminarStore";

interface RealtimeContextValue {
  activity: ActivityEvent[];
  paused: boolean;
  sessionCost: number;
  connected: boolean;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [paused, setPaused] = useState(true);
  const [sessionCost, setSessionCost] = useState(0);
  const mountedRef = useRef(true);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotQuery = useQuery(snapshotQueryOptions(queryClient));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const snapshot = snapshotQuery.data;
    if (!snapshot) return;
    seedSnapshot(queryClient, snapshot);
    setActivity(snapshot.activity);
    setPaused(snapshot.paused);
    setSessionCost(snapshot.session_cost);
  }, [queryClient, snapshotQuery.data]);

  useEffect(() => {
    let socket: WebSocket | null = null;

    const connect = () => {
      if (!mountedRef.current) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

      socket.onopen = () => {
        if (mountedRef.current) setConnected(true);
      };
      socket.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        reconnectTimerRef.current = setTimeout(connect, 2000);
      };
      socket.onerror = () => {
        socket?.close();
      };
      socket.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const message = JSON.parse(event.data) as WSMessage;
          applyWsMessage(queryClient, message, {
            setActivity,
            setPaused,
            setSessionCost,
            applySnapshotRealtime(snapshot) {
              setActivity(snapshot.activity);
              setPaused(snapshot.paused);
              setSessionCost(snapshot.session_cost);
            },
          });
        } catch {
          // Ignore malformed websocket payloads.
        }
      };
    };

    connect();

    return () => {
      socket?.close();
    };
  }, [queryClient]);

  const value = useMemo(
    () => ({ activity, paused, sessionCost, connected }),
    [activity, connected, paused, sessionCost],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeState() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error("RealtimeProvider missing");
  return context;
}
