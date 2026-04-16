export interface Study {
  idea_slug: string;
  study_number: number;
  started_at: string;
  completed_at: string | null;
  mode: "initial_exploration" | "follow_up_research";
  content?: string;
}

export interface Idea {
  slug: string;
  title: string;
  current_state: "not_started" | "initial_exploration" | "follow_up_research" | "done";
  locked: boolean;
  locked_by: number | null;
  locked_mode: string | null;
  recorded_at: string;
  last_studied: string | null;
  studies?: Study[];
}

export interface Proposal {
  slug: string;
  recorded_at: string;
  status: "pending" | "approved" | "rejected";
  title: string;
  author: string | null;
  sources: string[];
  description: string;
}

export interface StudyFile {
  title: string;
  mode: string;
  created_at: string;
  study_number: number;
  content: string;
}

export interface Worker {
  id: number;
  type: "initial_exploration" | "follow_up_research" | "connective_research";
  status: "idle" | "researching";
  current_slug: string | null;
  started_at: string | null;
  log_file: string | null;
}

export interface WorkerLogEvent {
  kind: "thinking" | "text" | "tool_call" | "tool_result" | "result" | "raw";
  body: string;
  label?: string;
  tool_id?: string;
  ts?: string | null;
}

export interface RunEntry {
  id: number;
  worker_id: number;
  worker_type: string;
  slug: string | null;
  study_number: number | null;
  study_title: string | null;
  study_filename: string | null;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number | null;
  cost_usd: number | null;
  cost_is_estimate: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  num_turns: number | null;
  log_file: string | null;
  completed: boolean | null;
}

export interface ActivityEvent {
  ts: string;
  message: string;
  slug?: string;
  worker_id?: number;
  study_filename?: string;
  proposal_slug?: string;
}

export type NavigationTarget =
  | { type: "idea"; slug: string }
  | { type: "study"; slug: string; study_number: number }
  | { type: "proposal"; slug: string };

export interface SnapshotState {
  ideas: Idea[];
  workers: Worker[];
  activity: ActivityEvent[];
  study_counts: Record<string, number>;
  proposals: Proposal[];
  paused: boolean;
  session_cost: number;
}

export type WSMessage =
  | { type: "snapshot"; data: SnapshotState }
  | { type: "activity_logged"; data: ActivityEvent }
  | { type: "idea_upserted"; data: Idea }
  | { type: "idea_deleted"; data: { slug: string } }
  | { type: "proposal_upserted"; data: Proposal }
  | { type: "proposal_deleted"; data: { slug: string } }
  | { type: "worker_upserted"; data: Worker }
  | { type: "worker_removed"; data: { id: number } }
  | { type: "study_count_updated"; data: { slug: string; count: number } }
  | { type: "study_counts_replaced"; data: Record<string, number> }
  | { type: "paused_changed"; data: boolean }
  | { type: "session_cost_changed"; data: number };
