import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { exportIdea } from "../../api/ideas";
import { useIdeas } from "../../hooks/useIdeas";
import { useIdeaDetail } from "../../hooks/useIdeaDetail";
import { useThreads } from "../../hooks/useThreads";
import type { Idea, NavigationTarget, Worker } from "../../types";
import { relativeTime, workerTypeLabel, WORKER_TYPE_COLORS } from "../../utils";
import { StudyCard } from "../StudyCard";
import { CopyMarkdownButton, ReadingPaneFrame } from "./ReadingPaneCommon";

const STATE_LABELS: Record<string, string> = {
  not_started: "Not Started",
  initial_exploration: "Exploring",
  follow_up_research: "Researching",
  done: "Done",
};

const STATE_CLASSES: Record<string, string> = {
  not_started: "state-badge--not-started",
  initial_exploration: "state-badge--active",
  follow_up_research: "state-badge--further",
  done: "state-badge--done",
};

interface Props {
  idea: Idea;
  activeWorkers: Map<string, Worker>;
  onWorkerClick: (workerId: number) => void;
  onNavigate: (target: NavigationTarget) => void;
  onStartThread: (ideaSlug: string | null, initialTitle: string) => void;
  onClose: () => void;
}

export function IdeaPane({ idea, activeWorkers, onWorkerClick, onNavigate, onStartThread, onClose }: Props) {
  const { markIdeaDone, reopenIdea, resetIdea, deleteIdea } = useIdeas();
  const { threads } = useThreads();
  const { content, title, meta, sources, children, initialExpectation, studies, isLoading } = useIdeaDetail(idea.slug);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [exporting, setExporting] = useState(false);
  const deleteBtnRef = useRef<HTMLButtonElement>(null);
  const resetBtnRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConfirmDelete(false);
    setConfirmReset(false);
  }, [idea.slug]);

  useEffect(() => {
    if (!confirmDelete && !confirmReset) return;
    const handleClick = (event: MouseEvent) => {
      if (confirmDelete && deleteBtnRef.current && !deleteBtnRef.current.contains(event.target as Node)) {
        setConfirmDelete(false);
      }
      if (confirmReset && resetBtnRef.current && !resetBtnRef.current.contains(event.target as Node)) {
        setConfirmReset(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [confirmDelete, confirmReset]);

  const handleReopen = () => {
    void reopenIdea(idea.slug);
  };

  const handleMarkDone = () => {
    void markIdeaDone(idea.slug);
  };

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    void resetIdea(idea.slug);
    setConfirmReset(false);
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    void deleteIdea(idea.slug);
    setConfirmDelete(false);
    onClose();
  };

  const handleExport = () => {
    setExporting(true);
    exportIdea(idea.slug)
      .then(async (markdown) => {
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${idea.slug}-export.md`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => setExporting(false));
  };

  const activeWorker = activeWorkers.get(idea.slug) ?? null;
  const ideaThreads = threads.filter((thread) => thread.idea_slug === idea.slug);

  return (
    <ReadingPaneFrame onClose={onClose} scrollRef={scrollRef}>
      <header className="reading-pane-header">
        <h1 className="reading-pane-title">{title ?? idea.title}</h1>
        <div className="reading-pane-meta">
          {(() => {
            const badgeLabel = activeWorker ? "Researching" : (STATE_LABELS[idea.current_state] || idea.current_state);
            const badgeClass = activeWorker ? "state-badge--further" : (STATE_CLASSES[idea.current_state] || "");
            return (
              <>
                <span className={`state-badge ${badgeClass}`}>
                  {badgeLabel}
                </span>
                {activeWorker && (
                  <button
                    className="locked-indicator locked-indicator--clickable"
                    onClick={() => onWorkerClick(activeWorker.id)}
                  >
                    <span className="pulse-dot pulse-dot--small" style={{ background: WORKER_TYPE_COLORS[activeWorker.type] }} />
                    Being researched by worker {activeWorker.id} ({workerTypeLabel(activeWorker.type)})
                  </button>
                )}
              </>
            );
          })()}
          {meta && (
            <span className="reading-pane-byline">
              {meta.author && <>{meta.author}</>}
              {meta.author && meta.created_at && <> · </>}
              {meta.created_at && <>{relativeTime(meta.created_at)}</>}
            </span>
          )}
          {content && <CopyMarkdownButton content={content} />}
        </div>
      </header>

      {!isLoading && (sources.length > 0 || children.length > 0) && (
        <div className="pedigree">
          {sources.length > 0 && (
            <div className="pedigree-group">
              <span className="pedigree-label">Derived from</span>
              {sources.map((source) => (
                <button key={source.slug} className="pedigree-link" onClick={() => onNavigate({ type: "idea", slug: source.slug })}>
                  {source.title}
                </button>
              ))}
            </div>
          )}
          {children.length > 0 && (
            <div className="pedigree-group">
              <span className="pedigree-label">Spawned</span>
              {children.map((child) => (
                <button key={child.slug} className="pedigree-link" onClick={() => onNavigate({ type: "idea", slug: child.slug })}>
                  {child.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isLoading && <div className="reading-pane-loading">Loading...</div>}

      {!isLoading && content && (
        <div className="prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}

      {!isLoading && initialExpectation && (
        <section className="initial-expectation-section">
          <div className="studies-divider">
            <span>Your initial expectation</span>
          </div>
          <div className="initial-expectation-card">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{initialExpectation.body}</ReactMarkdown>
          </div>
        </section>
      )}

      {!isLoading && studies.length > 0 && (
        <section className="studies-section">
          <div className="studies-divider studies-divider--plain">
            <span>Studies ({studies.length})</span>
          </div>
          {studies.map((study, index) => (
            <StudyCard
              key={study.study_number}
              study={study}
              index={index + 1}
              onClick={() => onNavigate({ type: "study", slug: idea.slug, study_number: study.study_number })}
            />
          ))}
        </section>
      )}

      {!isLoading && (
        <section className="director-note-section">
          <div className="section-header-row">
            <div className="studies-divider studies-divider--compact studies-divider--plain">
              <span>Threads ({ideaThreads.length})</span>
            </div>
            <button
              className="action-btn btn--primary"
              onClick={() => onStartThread(idea.slug, `About ${idea.title}`)}
            >
              + Thread
            </button>
          </div>
          <div className="idea-thread-list">
            {ideaThreads.map((thread) => (
              <button
                key={thread.id}
                className="study-card idea-thread-card"
                onClick={() => onNavigate({ type: "thread", id: thread.id })}
              >
                <div className="study-card-header">
                  <span className="study-card-number">
                    {thread.status === "waiting_on_user" ? "Waiting on you" : thread.status === "waiting_on_agent" ? "Waiting on agent" : "Closed"}
                  </span>
                  {thread.updated_at && (
                    <span className="study-card-time">{relativeTime(thread.updated_at)}</span>
                  )}
                </div>
                <div className="study-card-title idea-thread-card-title">{thread.title}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {!isLoading && (
        <footer className="reading-pane-actions">
          <div className="action-buttons">
            <button className="action-btn" onClick={handleExport} disabled={exporting}>
              {exporting ? "Exporting..." : "Export"}
            </button>
            {idea.current_state === "done" ? (
              <button className="action-btn" onClick={handleReopen}>
                Continue Researching
              </button>
            ) : (
              <button className="action-btn" onClick={handleMarkDone}>
                Mark Done
              </button>
            )}
            <button ref={resetBtnRef} className="action-btn" onClick={handleReset}>
              {confirmReset ? "Confirm Reset" : "Reset"}
            </button>
            <button ref={deleteBtnRef} className="action-btn" onClick={handleDelete}>
              {confirmDelete ? "Confirm Delete" : "Delete"}
            </button>
          </div>
          <p className="action-hint">
            {idea.current_state !== "done" && "Mark Done stops further research. "}
            Reset deletes all studies and restarts from scratch. Delete removes the idea entirely.
          </p>
        </footer>
      )}
    </ReadingPaneFrame>
  );
}
