import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useThreadDetail } from "../../hooks/useThreadDetail";
import { useThreads } from "../../hooks/useThreads";
import type { NavigationTarget, ThreadDetail, ThreadSummary, Worker } from "../../types";
import { relativeTime, workerTypeLabel, WORKER_TYPE_COLORS } from "../../utils";
import { CopyMarkdownButton, ReadingPaneFrame } from "./ReadingPaneCommon";

function isDocumentActive(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

function formatThreadStatus(status: ThreadSummary["status"]): string {
  return status.replace(/_/g, " ");
}

function formatMarkdownDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function buildThreadMarkdown(thread: ThreadDetail): string {
  const metadata = [
    `- Status: ${formatThreadStatus(thread.status)}`,
    `- Created: ${formatMarkdownDate(thread.created_at)}`,
    `- Updated: ${formatMarkdownDate(thread.updated_at)}`,
  ];

  if (thread.idea_slug) {
    metadata.push(`- Idea: ${thread.idea_slug}`);
  }

  const messages = thread.messages.map((message) => {
    const heading = `## ${message.author_name} (${message.author_type})`;
    const details = [`${formatMarkdownDate(message.created_at)}`];

    if (message.event_type) {
      details.push(`event: ${message.event_type}`);
    }
    if (message.related_idea_slug) {
      const related =
        message.related_study_number == null
          ? message.related_idea_slug
          : `${message.related_idea_slug} study ${message.related_study_number}`;
      details.push(`related: ${related}`);
    }

    return [heading, details.join(" · "), "", message.body.trim()].join("\n");
  });

  return [`# ${thread.title}`, "", metadata.join("\n"), "", ...messages].join("\n\n").trim() + "\n";
}

interface Props {
  thread: ThreadSummary;
  activeWorkers: Map<string, Worker>;
  onWorkerClick: (workerId: number) => void;
  onNavigate: (target: NavigationTarget) => void;
  onClose: () => void;
}

export function ThreadPane({ thread, activeWorkers, onWorkerClick, onNavigate, onClose }: Props) {
  const { replyToThread, closeThread, deleteThread } = useThreads();
  const { threadDetail, isLoading } = useThreadDetail(thread.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [threadReply, setThreadReply] = useState("");
  const [threadAuthorName, setThreadAuthorName] = useState("");
  const [threadSubmitting, setThreadSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevThreadMessageCountRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    prevThreadMessageCountRef.current = null;
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [thread.id]);

  useEffect(() => {
    setConfirmDelete(false);
  }, [thread.id, thread.updated_at]);

  useEffect(() => {
    if (!threadDetail || !scrollRef.current) return;

    const nextCount = threadDetail.messages.length;
    const previousCount = prevThreadMessageCountRef.current;
    const grew = previousCount != null && nextCount > previousCount;

    prevThreadMessageCountRef.current = nextCount;

    if (!grew || !isDocumentActive()) return;

    requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (!element) return;
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    });
  }, [thread.id, threadDetail]);

  const activeThreadWorker = activeWorkers.get(`thread-${thread.id}`) ?? null;
  const threadMarkdown = useMemo(
    () => (threadDetail ? buildThreadMarkdown(threadDetail) : null),
    [threadDetail],
  );

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    void deleteThread(thread.id);
    setConfirmDelete(false);
    onClose();
  };

  const handleReply = async () => {
    if (!threadReply.trim() || !threadAuthorName.trim()) return;
    setThreadSubmitting(true);
    try {
      await replyToThread(thread.id, {
        body: threadReply,
        author_name: threadAuthorName.trim(),
      });
      setThreadReply("");
    } finally {
      setThreadSubmitting(false);
    }
  };

  const handleCloseThread = () => {
    void closeThread(thread.id);
  };

  return (
    <ReadingPaneFrame onClose={onClose} scrollRef={scrollRef}>
      <header className="reading-pane-header">
        <h1 className="reading-pane-title">{thread.title}</h1>
        <div className="reading-pane-meta">
          {activeThreadWorker && (
            <button
              className="locked-indicator locked-indicator--clickable"
              onClick={() => onWorkerClick(activeThreadWorker.id)}
            >
              <span className="pulse-dot pulse-dot--small" style={{ background: WORKER_TYPE_COLORS[activeThreadWorker.type] }} />
              Being processed by worker {activeThreadWorker.id} ({workerTypeLabel(activeThreadWorker.type)})
            </button>
          )}
          <span className="reading-pane-byline">
            {formatThreadStatus(thread.status)}
            {thread.updated_at && <> · {relativeTime(thread.updated_at)}</>}
          </span>
          {threadMarkdown && <CopyMarkdownButton content={threadMarkdown} />}
        </div>
      </header>

      {thread.idea_slug && (
        <div className="pedigree">
          <div className="pedigree-group">
            <span className="pedigree-label">Idea</span>
            <button className="pedigree-link" onClick={() => onNavigate({ type: "idea", slug: thread.idea_slug! })}>
              {thread.idea_slug}
            </button>
          </div>
        </div>
      )}

      {isLoading && <div className="reading-pane-loading">Loading...</div>}

      {!isLoading && threadDetail && (
        <div className="thread-timeline">
          {threadDetail.messages.map((message) => (
            <div key={message.id} className={`thread-message thread-message--${message.author_type}`}>
              <div className="thread-message-meta">
                <span className="thread-message-author">{message.author_name}</span>
                <span className="thread-message-ts">{relativeTime(message.created_at)}</span>
              </div>
              {message.event_type && (
                <div className="thread-event-links">
                  {message.related_idea_slug && message.related_study_number != null ? (
                    <button
                      className="pedigree-link"
                      onClick={() => onNavigate({ type: "study", slug: message.related_idea_slug!, study_number: message.related_study_number! })}
                    >
                      Open resulting study
                    </button>
                  ) : message.related_idea_slug ? (
                    <button
                      className="pedigree-link"
                      onClick={() => onNavigate({ type: "idea", slug: message.related_idea_slug! })}
                    >
                      Open related idea
                    </button>
                  ) : null}
                </div>
              )}
              <div className="prose">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.body}</ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && (
        <footer className="reading-pane-actions thread-pane-actions">
          {thread.status === "waiting_on_user" && (
            <div className="thread-composer">
              <input
                className="modal-input"
                type="text"
                placeholder="Your name"
                value={threadAuthorName}
                onChange={(event) => setThreadAuthorName(event.target.value)}
              />
              <textarea
                className="modal-textarea"
                rows={6}
                placeholder="Reply"
                value={threadReply}
                onChange={(event) => setThreadReply(event.target.value)}
              />
              <div className="action-buttons">
                <button className="action-btn btn--primary" onClick={handleReply} disabled={threadSubmitting}>
                  {threadSubmitting ? "Sending..." : "Send Reply"}
                </button>
              </div>
            </div>
          )}
          <div className="studies-divider thread-actions-divider">
            <span>Thread Actions</span>
          </div>
          <div className="action-buttons">
            {thread.status !== "closed" && (
              <button className="action-btn" onClick={handleCloseThread}>Close Thread</button>
            )}
            <button className="action-btn" onClick={handleDelete}>
              {confirmDelete ? "Confirm Delete" : "Delete"}
            </button>
          </div>
        </footer>
      )}
    </ReadingPaneFrame>
  );
}
