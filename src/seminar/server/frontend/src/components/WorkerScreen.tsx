import { useState, useEffect, useRef, useCallback } from "react";
import { format, addDays, parseISO, isToday, isYesterday } from "date-fns";
import { getWorkerHistory, getWorkerRuns } from "../api/workers";
import type { Idea, ThreadSummary, Worker, WorkerLogEvent, RunEntry, NavigationTarget } from "../types";
import { workerTypeLabel } from "../utils";

interface Props {
  workers: Worker[];
  ideas: Idea[];
  threads: ThreadSummary[];
  initialWorkerId: number | null;
  onClose: () => void;
  onNavigate: (target: NavigationTarget) => void;
  onDismissWorker: (workerId: number) => void;
  onKillTask: (workerId: number) => void;
}

function isActive(w: Worker) {
  return w.status === "researching";
}

function formatElapsed(seconds: number | null): string {
  if (seconds == null) return "";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${Math.floor(seconds / 60)}m`;
}

function elapsedSeconds(startedAt: string | null): number | null {
  if (!startedAt) return null;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return null;
  return Math.max(0, Math.floor((Date.now() - started) / 1000));
}

const KIND_LABELS: Record<string, string> = {
  thinking: "THINK",
  text: "TEXT",
  tool_call: "TOOL",
  tool_result: "RESULT",
  result: "DONE",
  raw: "RAW",
};

function formatTime(ts: string | null | undefined): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function LogEvent({ event }: { event: WorkerLogEvent }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = event.body.length > 300 || event.body.split("\n").length > 4;
  const time = formatTime(event.ts);

  return (
    <div className={`log-event log-event--${event.kind}`}>
      {time && <span className="log-event-ts">{time}</span>}
      <span className="log-event-kind">
        {KIND_LABELS[event.kind] || event.kind}
      </span>
      {event.label && (
        <span className="log-event-label">{event.label}</span>
      )}
      <span
        className={`log-event-body ${!expanded && needsExpand ? "log-event-body--clamped" : ""}`}
        onClick={needsExpand ? () => setExpanded(!expanded) : undefined}
      >
        {event.body}
      </span>
    </div>
  );
}

/* ── Worker Card Grid ─────────────────────────────────── */

const TYPE_ORDER: Worker["type"][] = ["initial_exploration", "follow_up_research", "connective_research", "thread_response"];

function WorkerGrid({ workers, onSelect, titleFor }: { workers: Worker[]; onSelect: (w: Worker) => void; titleFor: (slug: string | null) => string | null }) {
  const [, setNow] = useState(Date.now());

  useEffect(() => {
    const hasActive = workers.some((w) => isActive(w) && w.started_at);
    if (!hasActive) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [workers]);

  const grouped = TYPE_ORDER
    .map((type) => ({ type, items: workers.filter((w) => w.type === type) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="worker-grid">
      {workers.length === 0 && (
        <div className="reading-pane-empty">No workers running</div>
      )}
      {grouped.map((group) => (
        <div key={group.type} className="worker-group">
          <div className="worker-group-header">
            <span className="worker-group-label">{workerTypeLabel(group.type)}</span>
            <span className="worker-group-count">{group.items.length}</span>
          </div>
          <div className="worker-group-cards">
            {group.items.map((w) => {
              return (
                <button
                  key={w.id}
                  className={`worker-card ${isActive(w) ? "worker-card--active" : ""}`}
                  onClick={() => onSelect(w)}
                >
                  <div className="worker-card-header">
                    <span className="worker-card-id">#{w.id}</span>
                    <span className="worker-card-status">
                      {isActive(w) ? titleFor(w.current_slug) ?? w.status : "idle"}
                    </span>
                    {isActive(w) && elapsedSeconds(w.started_at) != null && (
                      <span className="worker-card-elapsed">{formatElapsed(elapsedSeconds(w.started_at))}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Log Viewer (shared between live + history) ───────── */

function LogViewer({
  events,
  loading,
  live,
}: {
  events: WorkerLogEvent[];
  loading: boolean;
  live?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const checkAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  }, []);

  useEffect(() => {
    if (live && isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, live]);

  return (
    <div className="worker-log-body" ref={scrollRef} onScroll={live ? checkAtBottom : undefined}>
      {loading && events.length === 0 && (
        <div className="worker-log-empty">Loading log...</div>
      )}
      {!loading && events.length === 0 && (
        <div className="worker-log-empty">No log events yet</div>
      )}
      {events.map((event, i) => (
        <LogEvent key={i} event={event} />
      ))}
    </div>
  );
}

/* ── Worker Detail ────────────────────────────────────── */

function WorkerDetail({
  worker,
  onBack,
  onNavigate,
  onDismissWorker,
  onKillTask,
  titleFor,
}: {
  worker: Worker;
  onBack: () => void;
  onNavigate: (target: NavigationTarget) => void;
  onDismissWorker: (workerId: number) => void;
  onKillTask: (workerId: number) => void;
  titleFor: (slug: string | null) => string | null;
}) {
  const [events, setEvents] = useState<WorkerLogEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!worker.log_file) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const filename = worker.log_file.split("/").pop()!;
    const fetchLog = () => {
      getWorkerHistory(worker.id, filename)
        .then((data: { events: WorkerLogEvent[] }) => {
          if (!cancelled) {
            setEvents(data.events || []);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    };
    fetchLog();
    const interval = setInterval(fetchLog, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [worker.id, worker.log_file]);

  return (
    <div className="worker-detail">
      <button className="reading-pane-back" onClick={onBack}>&lsaquo; Back to Control Plane</button>

      <div className="worker-detail-header">
        <div className="worker-detail-info">
          <div className="worker-detail-title-row">
            <h2 className="worker-detail-title">Worker #{worker.id}</h2>
          </div>
          <div className="worker-detail-meta-row">
            <span className="worker-detail-type">{workerTypeLabel(worker.type)}</span>
            <span className="worker-detail-type">{displayProvider(worker.provider)}</span>
          </div>
        </div>
        <div className="worker-detail-actions">
          {isActive(worker) && (
            <button
              className="action-btn"
              onClick={() => {
                if (confirm(`Kill the current task for worker ${worker.id}? The worker will return to idle.`)) {
                  onKillTask(worker.id);
                }
              }}
            >
              Kill Task
            </button>
          )}
          <button
            className="action-btn"
            onClick={() => {
              const msg = isActive(worker)
                ? `This worker is currently ${worker.status} and will lose its progress. Remove worker ${worker.id}?`
                : `Remove worker ${worker.id}?`;
              if (confirm(msg)) {
                onDismissWorker(worker.id);
                onBack();
              }
            }}
          >
            Remove
          </button>
        </div>
      </div>

      {worker.current_slug && (
        <p className="worker-detail-working-on">
          Working on:{" "}
          <button
            className="worker-detail-slug"
            onClick={() => onNavigate({ type: "idea", slug: worker.current_slug! })}
          >
            {titleFor(worker.current_slug)}
          </button>
        </p>
      )}

      <div className="worker-detail-log-section">
        <h3 className="worker-detail-section-title">
          {isActive(worker) ? "Live Log" : "Latest Log"}
        </h3>
        <LogViewer events={events} loading={loading} live={isActive(worker)} />
      </div>
    </div>
  );
}

/* ── History Log View ─────────────────────────────────── */

function HistoryLogView({
  run,
  onBack,
  onNavigate,
  titleFor,
  threadTitleFor,
}: {
  run: RunEntry;
  onBack: () => void;
  onNavigate: (target: NavigationTarget) => void;
  titleFor: (slug: string | null) => string | null;
  threadTitleFor: (threadId: number) => string | null;
}) {
  const [events, setEvents] = useState<WorkerLogEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const filename = run.log_file?.split("/").pop() ?? "";

  useEffect(() => {
    if (!filename) { setLoading(false); return; }
    getWorkerHistory(run.worker_id, filename)
      .then((data: { events: WorkerLogEvent[] }) => {
        setEvents(data.events || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [run.worker_id, filename]);

  return (
    <div className="worker-detail">
      <button className="reading-pane-back" onClick={onBack}>&lsaquo; Back to History</button>

      <div className="worker-detail-header">
        <div className="worker-detail-info">
          <div className="worker-detail-title-row">
            <h2 className="worker-detail-title">Worker #{run.worker_id}</h2>
          </div>
          <span className="worker-detail-type">{workerTypeLabel(run.worker_type)}</span>
        </div>
        <div className="worker-detail-meta-row">
          <span className="worker-detail-meta">{displayProvider(run.provider)}</span>
          {run.cost_usd != null && (
            <span className="worker-detail-meta">{formatCost(run.cost_usd)}</span>
          )}
          {run.duration_ms != null && (
            <span className="worker-detail-meta">{formatDuration(run.duration_ms)}</span>
          )}
          {run.num_turns != null && (
            <span className="worker-detail-meta">{run.num_turns} turns</span>
          )}
        </div>
      </div>

      {run.slug && (() => {
        const threadMatch = run.slug.match(/^thread-(\d+)$/);
        if (threadMatch) {
          const threadId = parseInt(threadMatch[1], 10);
          return (
            <p className="worker-detail-working-on">
              <button
                className="worker-detail-slug"
                onClick={() => onNavigate({ type: "thread", id: threadId })}
              >
                {threadTitleFor(threadId) ?? run.slug}
              </button>
            </p>
          );
        }
        return (
          <p className="worker-detail-working-on">
            {run.study_title ? (
              <>
                <button
                  className="worker-detail-slug"
                  onClick={() => onNavigate(
                    run.study_number != null
                      ? { type: "study", slug: run.slug!, study_number: run.study_number }
                      : { type: "idea", slug: run.slug! }
                  )}
                >
                  {titleFor(run.slug)}
                </button>
                {run.study_number != null && <> &middot; Study #{run.study_number}</>}
                {" — "}{run.study_title}
              </>
            ) : (
              <button
                className="worker-detail-slug"
                onClick={() => onNavigate({ type: "idea", slug: run.slug! })}
              >
                {titleFor(run.slug)}
              </button>
            )}
          </p>
        );
      })()}

      <div className="worker-detail-log-section">
        <h3 className="worker-detail-section-title">Log</h3>
        <LogViewer events={events} loading={loading} />
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const remainder = s % 60;
    return remainder > 0 ? `${m}m ${remainder}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  const remainderM = m % 60;
  return remainderM > 0 ? `${h}h ${remainderM}m` : `${h}h`;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function displayProvider(provider: string): string {
  switch (provider) {
    case "ClaudeCodeProvider":
      return "claude-code";
    case "CodexProvider":
      return "codex";
    default:
      return provider;
  }
}

/* ── Global History ────────────────────────────────────── */

function runStatus(run: RunEntry): { label: string; key: string } {
  if (run.finished_at == null) return { label: "Running", key: "running" };
  if (run.completed) return { label: "Completed", key: "done" };
  return { label: "Failed", key: "failed" };
}

function GlobalHistory({
  workers,
  onNavigate,
  onViewLog,
  onGoToWorker,
  titleFor,
  threadTitleFor,
}: {
  workers: Worker[];
  onNavigate: (target: NavigationTarget) => void;
  onViewLog: (run: RunEntry) => void;
  onGoToWorker: (workerId: number) => void;
  titleFor: (slug: string | null) => string | null;
  threadTitleFor: (threadId: number) => string | null;
}) {
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const today = format(new Date(), "yyyy-MM-dd");

  const shiftDate = (days: number) => {
    const next = format(addDays(parseISO(date), days), "yyyy-MM-dd");
    if (next <= today) setDate(next);
  };

  const formatDateLabel = (dateStr: string) => {
    const d = parseISO(dateStr);
    if (isToday(d)) return "Today";
    if (isYesterday(d)) return "Yesterday";
    return format(d, "EEE, d MMM yyyy");
  };

  useEffect(() => {
    setLoading(true);
    getWorkerRuns(date)
      .then((data: { runs: RunEntry[] }) => {
        setRuns(data.runs || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [date]);

  const totalCost = runs.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
  const totalDuration = runs.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0);

  return (
    <div className="history-list">
      <div className="history-date-picker">
        <button className="icon-btn history-date-btn" onClick={() => shiftDate(-1)}>&lsaquo;</button>
        <span className="history-date-label">{formatDateLabel(date)}</span>
        <button className="icon-btn history-date-btn" onClick={() => shiftDate(1)} disabled={date >= today}>&rsaquo;</button>
      </div>

      {loading && <div className="worker-log-empty">Loading runs...</div>}

      {!loading && runs.length === 0 && (
        <div className="worker-log-empty">No runs for this date</div>
      )}

      {!loading && runs.length > 0 && (
        <div className="history-totals">
          <span>Total: {formatCost(totalCost)}</span>
          <span>{formatDuration(totalDuration)}</span>
          <span>{runs.length} runs</span>
        </div>
      )}

      <div className="history-entries">
        {runs.map((run) => {
          const status = runStatus(run);
          const isRunning = run.finished_at == null && workers.some((w) => w.id === run.worker_id);
          const hasLog = run.log_file != null;
          const clickable = isRunning || hasLog;
          const handleCardClick = () => {
            if (isRunning) onGoToWorker(run.worker_id);
            else if (hasLog) onViewLog(run);
          };
          return (
            <div
              key={run.id}
              className={`history-entry ${clickable ? "history-entry--clickable" : ""}`}
              onClick={clickable ? handleCardClick : undefined}
            >
              <div className="history-entry-top">
                <span className="history-entry-mode">
                  {workerTypeLabel(run.worker_type)}
                </span>
                <span className={`history-entry-status history-entry-status--${status.key}`}>
                  {status.label}
                </span>
                {run.cost_usd != null && (
                  <span className="history-entry-cost">{formatCost(run.cost_usd)}</span>
                )}
                {run.duration_ms != null && (
                  <span className="history-entry-duration">{formatDuration(run.duration_ms)}</span>
                )}
                <span className="history-entry-time">
                  {formatTime(run.started_at)}
                </span>
              </div>
              <div className="history-entry-body">
                {run.slug && (() => {
                  const threadMatch = run.slug.match(/^thread-(\d+)$/);
                  if (threadMatch) {
                    const threadId = parseInt(threadMatch[1], 10);
                    return (
                      <button
                        className="history-entry-slug"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigate({ type: "thread", id: threadId });
                        }}
                      >
                        {threadTitleFor(threadId) ?? run.slug}
                      </button>
                    );
                  }
                  return (
                    <button
                      className="history-entry-slug"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigate(
                          run.study_number != null
                            ? { type: "study", slug: run.slug!, study_number: run.study_number }
                            : { type: "idea", slug: run.slug! }
                        );
                      }}
                    >
                      {titleFor(run.slug)}
                    </button>
                  );
                })()}
                {run.study_title && (
                  <span className="history-entry-title">{run.study_title}</span>
                )}
              </div>
              <div className="history-entry-footer">
                <span className="history-entry-meta">
                  Worker #{run.worker_id}
                  {run.provider && <> &middot; {displayProvider(run.provider)}</>}
                  {run.study_number != null && <> &middot; Study #{run.study_number}</>}
                  {run.num_turns != null && <> &middot; {run.num_turns} turns</>}
                </span>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}

/* ── Main WorkerScreen ────────────────────────────────── */

type Tab = "workers" | "history";

export function WorkerScreen({ workers, ideas, threads, initialWorkerId, onClose, onNavigate, onDismissWorker, onKillTask }: Props) {
  const [tab, setTab] = useState<Tab>("workers");
  const [selectedId, setSelectedId] = useState<number | null>(initialWorkerId);
  const [historyRun, setHistoryRun] = useState<RunEntry | null>(null);

  const titleBySlug = Object.fromEntries(ideas.map((i) => [i.slug, i.title]));
  const titleFor = (slug: string | null) => (slug ? titleBySlug[slug] ?? slug : null);
  const titleById = Object.fromEntries(threads.map((t) => [t.id, t.title]));
  const threadTitleFor = (threadId: number) => titleById[threadId] ?? null;

  useEffect(() => {
    if (initialWorkerId != null) {
      setSelectedId(initialWorkerId);
      setTab("workers");
    }
  }, [initialWorkerId]);

  const selectedWorker = selectedId != null
    ? workers.find((w) => w.id === selectedId) ?? null
    : null;

  // Drilling into a specific log file
  if (historyRun) {
    return (
      <main className="reading-pane">
        <div className="reading-pane-scroll">
          <button className="icon-btn reading-pane-close" onClick={onClose} title="Close">&times;</button>
          <div className="reading-pane-content">
            <HistoryLogView
              run={historyRun}
              onBack={() => setHistoryRun(null)}
              onNavigate={onNavigate}
              titleFor={titleFor}
              threadTitleFor={threadTitleFor}
            />
          </div>
        </div>
      </main>
    );
  }

  // Drilling into a specific worker
  if (tab === "workers" && selectedWorker) {
    return (
      <main className="reading-pane">
        <div className="reading-pane-scroll">
          <button className="icon-btn reading-pane-close" onClick={onClose} title="Close">&times;</button>
          <div className="reading-pane-content">
            <WorkerDetail
              worker={selectedWorker}
              onBack={() => setSelectedId(null)}
              onNavigate={onNavigate}
              onDismissWorker={onDismissWorker}
              onKillTask={onKillTask}
              titleFor={titleFor}
            />
          </div>
        </div>
      </main>
    );
  }

  // Top-level: tabs
  return (
    <main className="reading-pane">
      <div className="reading-pane-scroll">
        <button className="icon-btn reading-pane-close" onClick={onClose} title="Close">&times;</button>
        <div className="reading-pane-content">
          <div className="worker-screen-header">
            <h1 className="reading-pane-title">Control Plane</h1>
            <div className="worker-screen-tabs">
              <button
                className={`worker-screen-tab ${tab === "workers" ? "worker-screen-tab--active" : ""}`}
                onClick={() => setTab("workers")}
              >
                Active Workers ({workers.length})
              </button>
              <button
                className={`worker-screen-tab ${tab === "history" ? "worker-screen-tab--active" : ""}`}
                onClick={() => setTab("history")}
              >
                History
              </button>
            </div>
          </div>
          {tab === "workers" ? (
            <WorkerGrid workers={workers} onSelect={(w) => setSelectedId(w.id)} titleFor={titleFor} />
          ) : (
            <GlobalHistory
              workers={workers}
              onNavigate={onNavigate}
              onViewLog={(run) => setHistoryRun(run)}
              onGoToWorker={(workerId) => { setSelectedId(workerId); setTab("workers"); }}
              titleFor={titleFor}
              threadTitleFor={threadTitleFor}
            />
          )}
        </div>
      </div>
    </main>
  );
}
