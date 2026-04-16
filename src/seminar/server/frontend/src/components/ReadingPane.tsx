import { useState, useEffect, useRef, useMemo, useCallback, isValidElement, type ReactNode, type ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Idea, StudyFile, Worker, Proposal, NavigationTarget } from "../types";
import { useIdeas } from "../hooks/useIdeas";
import { useProposals } from "../hooks/useProposals";
import { relativeTime, workerTypeLabel, studyModeLabel, WORKER_TYPE_COLORS } from "../utils";
import { StudyCard } from "./StudyCard";

function CopyMarkdownButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [content]);
  return (
    <button className="copy-md-btn" onClick={handleCopy} title="Copy as Markdown">
      {copied ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3.5,9 6.5,12 12.5,4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="5" width="8" height="9" rx="1" />
          <path d="M3 11V3a1 1 0 0 1 1-1h6" />
        </svg>
      )}
    </button>
  );
}

interface TocEntry {
  level: number;
  text: string;
  id: string;
}

function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      const text = match[2].trim().replace(/`/g, "");
      const id = text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
      entries.push({ level: match[1].length, text, id });
    }
  }
  return entries;
}

function slugifyHeading(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
}

function textContent(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement(node)) return textContent((node as ReactElement<{ children?: ReactNode }>).props.children);
  return "";
}

function HeadingWithId({ level, children, scrollRef, ...props }: { level: number; children?: React.ReactNode; scrollRef?: React.RefObject<HTMLDivElement | null> } & React.HTMLAttributes<HTMLHeadingElement>) {
  const text = textContent(children);
  const id = slugifyHeading(text);

  const backToTop = () => {
    scrollRef?.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const heading = (
    <span className="heading-with-top">
      {children}
      <span className="back-to-top" role="button" onClick={backToTop} title="Back to contents">
        back to top
      </span>
    </span>
  );

  if (level === 1) return <h1 id={id} {...props}>{heading}</h1>;
  if (level === 2) return <h2 id={id} {...props}>{heading}</h2>;
  return <h3 id={id} {...props}>{heading}</h3>;
}

function makeHeadingComponents(scrollRef: React.RefObject<HTMLDivElement | null>) {
  return {
    h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithId level={1} scrollRef={scrollRef} {...props} />,
    h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithId level={2} scrollRef={scrollRef} {...props} />,
    h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithId level={3} scrollRef={scrollRef} {...props} />,
  };
}

function TableOfContents({ entries, scrollRef }: { entries: TocEntry[]; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  if (entries.length === 0) return null;

  const handleClick = (id: string) => {
    const container = scrollRef.current;
    if (!container) return;
    const el = container.querySelector(`#${CSS.escape(id)}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <nav className="toc">
      <div className="toc-title">Contents</div>
      <ul className="toc-list">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={`toc-item${entry.level === 2 ? " toc-item--h2" : entry.level >= 3 ? " toc-item--h3" : ""}`}
          >
            <button className="toc-link" onClick={() => handleClick(entry.id)}>
              {entry.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

interface Props {
  idea: Idea | null;
  selectedProposal: Proposal | null;
  activeWorkers: Map<string, Worker>;
  onWorkerClick: (workerId: number) => void;
  selectedStudy: number | null;
  studiesCache: Record<string, StudyFile[]>;
  fetchStudies: (slug: string) => void;
  onNavigate: (target: NavigationTarget) => void;
  onClose: () => void;
}


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

export function ReadingPane({ idea, selectedProposal, activeWorkers, onWorkerClick, selectedStudy, studiesCache, fetchStudies, onNavigate, onClose }: Props) {
  const {
    markIdeaDone,
    reopenIdea,
    resetIdea,
    deleteIdea,
    addDirectorNote,
  } = useIdeas();
  const { approveProposal, rejectProposal, deleteProposal } = useProposals();
  const [content, setContent] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [meta, setMeta] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmDeleteProposal, setConfirmDeleteProposal] = useState(false);
  const [proposalContent, setProposalContent] = useState<string | null>(null);
  const [proposalMeta, setProposalMeta] = useState<Record<string, string> | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [sources, setSources] = useState<{ slug: string; title: string }[]>([]);
  const [children, setChildren] = useState<{ slug: string; title: string }[]>([]);
  const [noteText, setNoteText] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const deleteBtnRef = useRef<HTMLButtonElement>(null);
  const deleteProposalBtnRef = useRef<HTMLButtonElement>(null);
  const resetBtnRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirmDelete && !confirmReset && !confirmDeleteProposal) return;
    const handleClick = (e: MouseEvent) => {
      if (confirmDelete && deleteBtnRef.current && !deleteBtnRef.current.contains(e.target as Node)) {
        setConfirmDelete(false);
      }
      if (confirmReset && resetBtnRef.current && !resetBtnRef.current.contains(e.target as Node)) {
        setConfirmReset(false);
      }
      if (confirmDeleteProposal && deleteProposalBtnRef.current && !deleteProposalBtnRef.current.contains(e.target as Node)) {
        setConfirmDeleteProposal(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [confirmDelete, confirmReset, confirmDeleteProposal]);

  useEffect(() => {
    if (!idea) {
      setContent(null);
      setTitle(null);
      setMeta(null);
      return;
    }

    setLoading(true);
    setContent(null);
    setTitle(null);
    setMeta(null);
    setSources([]);
    setChildren([]);
    setConfirmDelete(false);
    setConfirmReset(false);
    fetchStudies(idea.slug);

    fetch(`/api/ideas/${idea.slug}/sources`).then((r) => r.json()).then(setSources).catch(() => {});
    fetch(`/api/ideas/${idea.slug}/children`).then((r) => r.json()).then(setChildren).catch(() => {});

    fetch(`/api/ideas/${idea.slug}/content`)
      .then((r) => r.json())
      .then((ideaContent) => {
        if (ideaContent) {
          setContent(ideaContent.content);
          setTitle(ideaContent.meta?.title || null);
          setMeta(ideaContent.meta || null);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [idea?.slug, fetchStudies]);

  useEffect(() => {
    if (!selectedProposal) {
      setProposalContent(null);
      setProposalMeta(null);
      return;
    }
    setProposalLoading(true);
    setProposalContent(null);
    setProposalMeta(null);
    setConfirmReject(false);
    setConfirmDeleteProposal(false);
    fetch(`/api/proposals/${selectedProposal.slug}/content`)
      .then((r) => r.json())
      .then((data) => {
        setProposalContent(data.content ?? null);
        setProposalMeta(data.meta ?? null);
        setProposalLoading(false);
      })
      .catch(() => setProposalLoading(false));
  }, [selectedProposal?.slug]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [selectedStudy]);

  const studies = idea ? (studiesCache[idea.slug] ?? []) : [];

  const activeStudy = selectedStudy
    ? studies.find((s) => s.study_number === selectedStudy) ?? null
    : null;

  const tocEntries = useMemo(
    () => (activeStudy?.content ? extractToc(activeStudy.content) : []),
    [activeStudy?.content]
  );

  const mdComponents = useMemo(() => makeHeadingComponents(scrollRef), [scrollRef]);

  if (selectedProposal) {
    const handleApprove = () => {
      void approveProposal(selectedProposal.slug);
    };
    const handleRejectProposal = () => {
      if (!confirmReject) {
        setConfirmReject(true);
        return;
      }
      void rejectProposal(selectedProposal.slug);
      setConfirmReject(false);
    };
    const handleDeleteProposal = () => {
      if (!confirmDeleteProposal) {
        setConfirmDeleteProposal(true);
        return;
      }
      void deleteProposal(selectedProposal.slug);
      setConfirmDeleteProposal(false);
      onClose();
    };

    return (
      <main className="reading-pane">
        <div className="reading-pane-scroll" ref={scrollRef}>
          <button className="reading-pane-close" onClick={onClose} title="Close">&times;</button>
          <article className="reading-pane-content">
            <header className="reading-pane-header">
              <h1 className="reading-pane-title">{selectedProposal.title}</h1>
              <div className="reading-pane-meta">
                <span className="state-badge state-badge--proposed">
                  {selectedProposal.status === "pending" ? "Proposed" : "Rejected"}
                </span>
                {proposalMeta && (
                  <span className="reading-pane-byline">
                    {proposalMeta.author && <>{proposalMeta.author}</>}
                    {proposalMeta.author && proposalMeta.created_at && <> · </>}
                    {proposalMeta.created_at && <>{relativeTime(proposalMeta.created_at)}</>}
                  </span>
                )}
                {proposalContent && <CopyMarkdownButton content={proposalContent} />}
              </div>
            </header>

            {selectedProposal.sources.length > 0 && (
              <div className="pedigree">
                <div className="pedigree-group">
                  <span className="pedigree-label">Derived from</span>
                  {selectedProposal.sources.map((slug) => (
                    <button key={slug} className="pedigree-link" onClick={() => onNavigate({ type: "idea", slug })}>
                      {slug}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {proposalLoading && <div className="reading-pane-loading">Loading...</div>}

            {!proposalLoading && proposalContent && (
              <div className="prose">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{proposalContent}</ReactMarkdown>
              </div>
            )}

            {!proposalLoading && selectedProposal.status === "pending" && (
              <footer className="reading-pane-actions">
                <div className="action-buttons">
                  <button className="action-btn action-btn--done" onClick={handleApprove}>
                    Approve
                  </button>
                  <button className="action-btn action-btn--delete" onClick={handleRejectProposal}>
                    {confirmReject ? "Confirm Reject" : "Reject"}
                  </button>
                </div>
                <p className="action-hint">
                  Approve creates a new idea and queues it for research. Reject discards the proposal.
                </p>
              </footer>
            )}

            {!proposalLoading && selectedProposal.status === "rejected" && (
              <footer className="reading-pane-actions">
                <div className="action-buttons">
                  <button
                    ref={deleteProposalBtnRef}
                    className="action-btn action-btn--delete"
                    onClick={handleDeleteProposal}
                  >
                    {confirmDeleteProposal ? "Confirm Delete" : "Delete"}
                  </button>
                </div>
                <p className="action-hint">
                  Delete removes the rejected proposal entirely.
                </p>
              </footer>
            )}
          </article>
        </div>
      </main>
    );
  }

  if (!idea) {
    return (
      <main className="reading-pane">
        <div className="reading-pane-empty">
          Select an idea to start reading
        </div>
      </main>
    );
  }

  if (activeStudy) {
    return (
      <main className="reading-pane">
        <div className="reading-pane-scroll" ref={scrollRef}>
          <button className="reading-pane-close" onClick={onClose} title="Close">&times;</button>
          <article className="reading-pane-content">
            <button className="reading-pane-back" onClick={() => onNavigate({ type: "idea", slug: idea.slug })}>
              &larr; {title}
            </button>
            <header className="reading-pane-header">
              <h1 className="reading-pane-title">{activeStudy.title}</h1>
              <div className="reading-pane-meta">
                {activeStudy.mode && (
                  <span className="state-badge state-badge--active">{studyModeLabel(activeStudy.mode)}</span>
                )}
                {activeStudy.created_at && (
                  <span className="reading-pane-byline">{relativeTime(activeStudy.created_at)}</span>
                )}
                {activeStudy.content && <CopyMarkdownButton content={activeStudy.content} />}
              </div>
            </header>
            <div id="toc-top" />
            <TableOfContents entries={tocEntries} scrollRef={scrollRef} />
            {activeStudy.content && (
              <div className="prose">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {activeStudy.content}
                </ReactMarkdown>
              </div>
            )}
          </article>
        </div>
      </main>
    );
  }

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

  const activeWorker = activeWorkers.get(idea.slug) ?? null;

  return (
    <main className="reading-pane">
      <div className="reading-pane-scroll" ref={scrollRef}>
        <button className="reading-pane-close" onClick={onClose} title="Close">&times;</button>
        <article className="reading-pane-content">
          <header className="reading-pane-header">
            <h1 className="reading-pane-title">{title}</h1>
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

          {!loading && (sources.length > 0 || children.length > 0) && (
            <div className="pedigree">
              {sources.length > 0 && (
                <div className="pedigree-group">
                  <span className="pedigree-label">Derived from</span>
                  {sources.map((s) => (
                    <button key={s.slug} className="pedigree-link" onClick={() => onNavigate({ type: "idea", slug: s.slug })}>
                      {s.title}
                    </button>
                  ))}
                </div>
              )}
              {children.length > 0 && (
                <div className="pedigree-group">
                  <span className="pedigree-label">Spawned</span>
                  {children.map((c) => (
                    <button key={c.slug} className="pedigree-link" onClick={() => onNavigate({ type: "idea", slug: c.slug })}>
                      {c.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {loading && <div className="reading-pane-loading">Loading...</div>}

          {!loading && content && (
            <div className="prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          )}

          {!loading && studies.length > 0 && (
            <section className="studies-section">
              <div className="studies-divider">
                <span>Studies ({studies.length})</span>
              </div>
              {studies.map((study, i) => (
                <StudyCard
                  key={study.study_number}
                  study={study}
                  index={i + 1}
                  onClick={() => onNavigate({ type: "study", slug: idea.slug, study_number: study.study_number })}
                />
              ))}
            </section>
          )}

          {!loading && (
            <section className="director-note-section">
              <div className="studies-divider">
                <span>Add director's note</span>
              </div>
              <textarea
                className="director-note-input"
                placeholder="Ask a follow-up question, challenge a finding, or redirect the research..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={3}
              />
              <button
                className="action-btn action-btn--done director-note-submit"
                disabled={!noteText.trim() || noteSubmitting}
                onClick={() => {
                  setNoteSubmitting(true);
                  addDirectorNote(idea.slug, noteText.trim())
                    .then(() => {
                      setNoteText("");
                      fetchStudies(idea.slug);
                    })
                    .finally(() => setNoteSubmitting(false));
                }}
              >
                {noteSubmitting ? "Submitting..." : "Submit"}
              </button>
            </section>
          )}

          {!loading && (
            <footer className="reading-pane-actions">
              <div className="action-buttons">
                {idea.current_state === "done" ? (
                  <button
                    className="action-btn action-btn--reopen"
                    onClick={handleReopen}
                  >
                    Continue Researching
                  </button>
                ) : (
                  <button
                    className="action-btn action-btn--done"
                    onClick={handleMarkDone}
                  >
                    Mark Done
                  </button>
                )}
                <button
                  ref={resetBtnRef}
                  className="action-btn action-btn--reset"
                  onClick={handleReset}
                >
                  {confirmReset ? "Confirm Reset" : "Reset"}
                </button>
                <button
                  ref={deleteBtnRef}
                  className="action-btn action-btn--delete"
                  onClick={handleDelete}
                >
                  {confirmDelete ? "Confirm Delete" : "Delete"}
                </button>
              </div>
              <p className="action-hint">
                {idea.current_state !== "done" && "Mark Done stops further research. "}
                Reset deletes all studies and restarts from scratch. Delete removes the idea entirely.
              </p>
            </footer>
          )}
        </article>
      </div>
    </main>
  );
}
