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

export interface InitialExpectation {
  idea_slug: string;
  body: string;
  created_at: string;
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

export interface ThreadSummary {
  id: number;
  title: string;
  status: "waiting_on_user" | "waiting_on_agent" | "closed";
  idea_slug: string | null;
  assigned_responder: string | null;
  assigned_run_id: number | null;
  created_at: string;
  updated_at: string;
  preview: string;
  message_count: number;
  last_author_type: "user" | "agent" | "system" | null;
  last_author_name: string | null;
}

export interface ThreadMessage {
  id: number;
  thread_id: number;
  author_type: "user" | "agent" | "system";
  author_name: string;
  body: string;
  created_at: string;
  event_type: string | null;
  related_idea_slug: string | null;
  related_study_number: number | null;
}

export interface ThreadDetail extends ThreadSummary {
  messages: ThreadMessage[];
}

export interface Responder {
  id: string;
  label: string;
}

export interface StudyFile {
  title: string;
  mode: string;
  created_at: string;
  study_number: number;
  content: string;
}

export interface Annotation {
  id: number;
  idea_slug: string;
  study_number: number;
  rendered_text_start_offset: number;
  rendered_text_end_offset: number;
  rendered_text: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface Worker {
  id: number;
  type: "initial_exploration" | "follow_up_research" | "connective_research" | "thread_response";
  provider: string;
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
  provider: string;
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
  thread_id?: number;
  worker_id?: number;
  study_filename?: string;
  proposal_slug?: string;
}

export type NavigationTarget =
  | { type: "idea"; slug: string }
  | { type: "study"; slug: string; study_number: number }
  | { type: "proposal"; slug: string }
  | { type: "thread"; id: number }
  | { type: "annotation"; slug: string; study_number: number; annotation_id: number };

export interface SnapshotState {
  ideas: Idea[];
  workers: Worker[];
  activity: ActivityEvent[];
  study_counts: Record<string, number>;
  proposals: Proposal[];
  threads: ThreadSummary[];
  paused: boolean;
  session_cost: number;
  responders: Responder[];
}

export interface TimingSettings {
  initial: number;
  follow_up: number;
  connective: number;
}

export interface WorkerSettings {
  initial: number;
  follow_up: number;
  connective: number;
}

export interface Settings {
  provider: string;
  agent_cmd: string;
  intervals: TimingSettings;
  timeouts: TimingSettings;
  workers: WorkerSettings;
  follow_up_research_cooldown_minutes: number;
  tools: string[];
  available_providers: string[];
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
  | { type: "session_cost_changed"; data: number }
  | { type: "thread_upserted"; data: ThreadSummary }
  | { type: "thread_deleted"; data: { id: number } }
  | { type: "thread_message_added"; data: ThreadMessage };
