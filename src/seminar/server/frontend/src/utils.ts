export function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export const WORKER_TYPE_COLORS: Record<string, string> = {
  initial_exploration: "var(--amber)",
  follow_up_research: "var(--violet)",
  connective_research: "var(--accent)",
};

export const WORKER_TYPE_LABELS: Record<string, string> = {
  initial_exploration: "Initial Exploration",
  follow_up_research: "Follow-up Research",
  connective_research: "Connective Research",
};

export function workerTypeLabel(type: string): string {
  return WORKER_TYPE_LABELS[type] ?? type;
}

const STUDY_MODE_LABELS: Record<string, string> = {
  initial_exploration: "Initial exploration",
  follow_up_research: "Follow-up research",
  director_note: "Director's Note",
};

export function studyModeLabel(mode: string): string {
  return STUDY_MODE_LABELS[mode] ?? mode;
}

export function stateGroup(state: string): "not_started" | "active" | "done" {
  switch (state) {
    case "not_started":
      return "not_started";
    case "initial_exploration":
    case "follow_up_research":
      return "active";
    case "done":
      return "done";
    default:
      return "not_started";
  }
}
