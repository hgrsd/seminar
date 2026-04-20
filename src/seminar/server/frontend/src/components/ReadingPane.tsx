import { useState, useEffect, useRef, useMemo, useCallback, isValidElement, type ReactNode, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  exportIdea,
  getIdeaChildren,
  getIdeaContent,
  getIdeaInitialExpectation,
  getIdeaSources,
} from "../api/ideas";
import { getProposalContent } from "../api/proposals";
import { getThread as getThreadDetail } from "../api/threads";
import { queryKeys } from "../realtime/queryKeys";
import type { Idea, StudyFile, Worker, Proposal, ThreadSummary, NavigationTarget, InitialExpectation } from "../types";
import { useIdeas } from "../hooks/useIdeas";
import { useProposals } from "../hooks/useProposals";
import { useThreads } from "../hooks/useThreads";
import { useStudyAnnotations } from "../hooks/useStudyAnnotations";
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

function isNearBottom(element: HTMLDivElement, threshold = 80): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

interface Props {
  idea: Idea | null;
  selectedProposal: Proposal | null;
  selectedThread: ThreadSummary | null;
  activeWorkers: Map<string, Worker>;
  onWorkerClick: (workerId: number) => void;
  selectedStudy: number | null;
  scrollToAnnotationId: number | null;
  onScrollToAnnotationHandled: () => void;
  studiesCache: Record<string, StudyFile[]>;
  fetchStudies: (slug: string) => void;
  onNavigate: (target: NavigationTarget) => void;
  onStartThread: (ideaSlug: string | null, initialTitle: string) => void;
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

export function ReadingPane({ idea, selectedProposal, selectedThread, activeWorkers, onWorkerClick, selectedStudy, scrollToAnnotationId, onScrollToAnnotationHandled, studiesCache, fetchStudies, onNavigate, onStartThread, onClose }: Props) {
  const {
    markIdeaDone,
    reopenIdea,
    resetIdea,
    deleteIdea,
  } = useIdeas();
  const { approveProposal, rejectProposal, deleteProposal } = useProposals();
  const { threads, replyToThread, closeThread, deleteThread } = useThreads();
  const [content, setContent] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [meta, setMeta] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmDeleteProposal, setConfirmDeleteProposal] = useState(false);
  const [confirmDeleteThread, setConfirmDeleteThread] = useState(false);
  const [threadReply, setThreadReply] = useState("");
  const [threadAuthorName, setThreadAuthorName] = useState("");
  const [threadSubmitting, setThreadSubmitting] = useState(false);
  const [proposalContent, setProposalContent] = useState<string | null>(null);
  const [proposalMeta, setProposalMeta] = useState<Record<string, string> | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [sources, setSources] = useState<{ slug: string; title: string }[]>([]);
  const [children, setChildren] = useState<{ slug: string; title: string }[]>([]);
  const [initialExpectation, setInitialExpectation] = useState<InitialExpectation | null>(null);
  const [exporting, setExporting] = useState(false);
  const deleteBtnRef = useRef<HTMLButtonElement>(null);
  const deleteProposalBtnRef = useRef<HTMLButtonElement>(null);
  const resetBtnRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevThreadIdRef = useRef<number | null>(null);
  const prevThreadMessageCountRef = useRef(0);
  const threadShouldScrollRef = useRef(false);
  const threadAtBottomRef = useRef(true);
  const pendingOwnReplyRef = useRef(false);
  const threadDetailQuery = useQuery({
    queryKey: selectedThread ? queryKeys.thread(selectedThread.id) : ["thread", "disabled"],
    queryFn: ({ signal }) => {
      if (!selectedThread) throw new Error("Thread detail requested without a selected thread");
      return getThreadDetail(selectedThread.id, signal);
    },
    enabled: Boolean(selectedThread),
    staleTime: Infinity,
  });
  const threadDetail = selectedThread ? (threadDetailQuery.data ?? null) : null;
  const threadLoading = Boolean(selectedThread) && threadDetailQuery.isLoading;

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
      setInitialExpectation(null);
      return;
    }

    setLoading(true);
    setContent(null);
    setTitle(null);
    setMeta(null);
    setSources([]);
    setChildren([]);
    setInitialExpectation(null);
    setConfirmDelete(false);
    setConfirmReset(false);
    fetchStudies(idea.slug);

    getIdeaSources(idea.slug).then(setSources).catch(() => {});
    getIdeaChildren(idea.slug).then(setChildren).catch(() => {});
    getIdeaInitialExpectation(idea.slug)
      .then((value) => setInitialExpectation(value))
      .catch(() => {});

    getIdeaContent(idea.slug)
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
    getProposalContent(selectedProposal.slug)
      .then((data) => {
        setProposalContent(data.content ?? null);
        setProposalMeta(data.meta ?? null);
        setProposalLoading(false);
      })
      .catch(() => setProposalLoading(false));
  }, [selectedProposal?.slug]);

  useEffect(() => {
    if (!selectedThread) {
      prevThreadIdRef.current = null;
      prevThreadMessageCountRef.current = 0;
      threadShouldScrollRef.current = false;
      pendingOwnReplyRef.current = false;
      return;
    }
    const isNewThread = prevThreadIdRef.current !== selectedThread.id;
    if (isNewThread) {
      prevThreadIdRef.current = selectedThread.id;
      prevThreadMessageCountRef.current = 0;
      threadShouldScrollRef.current = true;
    } else if (scrollRef.current) {
      threadShouldScrollRef.current = threadAtBottomRef.current;
    }
    setConfirmDeleteThread(false);
  }, [selectedThread?.id, selectedThread?.updated_at]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [selectedStudy]);

  useEffect(() => {
    if (!selectedThread || !scrollRef.current) return;

    const element = scrollRef.current;
    const updateScrollState = () => {
      threadAtBottomRef.current = isNearBottom(element);
    };

    updateScrollState();
    element.addEventListener("scroll", updateScrollState);
    return () => element.removeEventListener("scroll", updateScrollState);
  }, [selectedThread?.id]);

  useEffect(() => {
    if (!selectedThread || !threadDetail || !scrollRef.current) return;

    const nextCount = threadDetail.messages.length;
    const previousCount = prevThreadMessageCountRef.current;
    const grew = nextCount > previousCount;
    const shouldScroll =
      threadShouldScrollRef.current ||
      pendingOwnReplyRef.current ||
      (grew && threadAtBottomRef.current);

    prevThreadMessageCountRef.current = nextCount;

    if (!shouldScroll) return;

    requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (!element) return;
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
      threadAtBottomRef.current = true;
      threadShouldScrollRef.current = false;
      pendingOwnReplyRef.current = false;
    });
  }, [selectedThread?.id, threadDetail]);

  const studies = idea ? (studiesCache[idea.slug] ?? []) : [];

  const activeStudy = selectedStudy
    ? studies.find((s) => s.study_number === selectedStudy) ?? null
    : null;

  const tocEntries = useMemo(
    () => (activeStudy?.content ? extractToc(activeStudy.content) : []),
    [activeStudy?.content]
  );

  const mdComponents = useMemo(() => makeHeadingComponents(scrollRef), [scrollRef]);
  const ideaThreads = useMemo(
    () => (idea ? threads.filter((thread) => thread.idea_slug === idea.slug) : []),
    [idea, threads],
  );
  const {
    annotationLoading,
    annotationBody,
    annotationPopover,
    activeAnnotation,
    studyProseRef,
    setAnnotationBody,
    beginCreate,
    cancelEdit,
    cancelPopover,
    createAnnotation,
    deleteAnnotation,
    handleStudyClick,
    handleStudySelection,
    startEdit,
    updateAnnotation,
  } = useStudyAnnotations(
    idea?.slug,
    selectedStudy,
    activeStudy?.content,
    scrollToAnnotationId,
    onScrollToAnnotationHandled,
  );

  if (selectedThread) {
    const activeThreadWorker = activeWorkers.get(`thread-${selectedThread.id}`) ?? null;
    const handleDeleteThread = () => {
      if (!confirmDeleteThread) {
        setConfirmDeleteThread(true);
        return;
      }
      void deleteThread(selectedThread.id);
      setConfirmDeleteThread(false);
      onClose();
    };
    const handleReply = async () => {
      if (!threadReply.trim() || !threadAuthorName.trim()) return;
      setThreadSubmitting(true);
      pendingOwnReplyRef.current = true;
      try {
        await replyToThread(selectedThread.id, {
          body: threadReply,
          author_name: threadAuthorName.trim(),
        });
        setThreadReply("");
      } finally {
        setThreadSubmitting(false);
      }
    };
    const handleCloseThread = () => {
      void closeThread(selectedThread.id);
    };

    return (
      <main className="reading-pane">
        <div className="reading-pane-scroll" ref={scrollRef}>
          <button className="icon-btn reading-pane-close" onClick={onClose} title="Close">&times;</button>
          <article className="reading-pane-content">
            <header className="reading-pane-header">
              <h1 className="reading-pane-title">{selectedThread.title}</h1>
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
                  {selectedThread.status.replace(/_/g, " ")}
                  {selectedThread.updated_at && <> · {relativeTime(selectedThread.updated_at)}</>}
                </span>
              </div>
            </header>

            {selectedThread.idea_slug && (
              <div className="pedigree">
                <div className="pedigree-group">
                  <span className="pedigree-label">Idea</span>
                  <button className="pedigree-link" onClick={() => onNavigate({ type: "idea", slug: selectedThread.idea_slug! })}>
                    {selectedThread.idea_slug}
                  </button>
                </div>
              </div>
            )}

            {threadLoading && <div className="reading-pane-loading">Loading...</div>}

            {!threadLoading && threadDetail && (
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

            {!threadLoading && (
              <footer className="reading-pane-actions thread-pane-actions">
                {selectedThread.status === "waiting_on_user" && (
                  <div className="thread-composer">
                    <input
                      className="modal-input"
                      type="text"
                      placeholder="Your name"
                      value={threadAuthorName}
                      onChange={(e) => setThreadAuthorName(e.target.value)}
                    />
                    <textarea
                      className="modal-textarea"
                      rows={6}
                      placeholder="Reply"
                      value={threadReply}
                      onChange={(e) => setThreadReply(e.target.value)}
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
                  {selectedThread.status !== "closed" && (
                    <button className="action-btn" onClick={handleCloseThread}>Close Thread</button>
                  )}
                  <button className="action-btn" onClick={handleDeleteThread}>
                    {confirmDeleteThread ? "Confirm Delete" : "Delete"}
                  </button>
                </div>
              </footer>
            )}
          </article>
        </div>
      </main>
    );
  }

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
          <button className="icon-btn reading-pane-close" onClick={onClose} title="Close">&times;</button>
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
                  <button className="action-btn btn--primary" onClick={handleApprove}>
                    Approve
                  </button>
                  <button className="action-btn" onClick={handleRejectProposal}>
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
                    className="action-btn"
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
          <button className="icon-btn reading-pane-close" onClick={onClose} title="Close">&times;</button>
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
              <div
                ref={studyProseRef}
                className="prose prose--annotatable"
                onMouseUp={handleStudySelection}
                onClick={handleStudyClick}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {activeStudy.content}
                </ReactMarkdown>
              </div>
            )}
            {annotationLoading && (
              <div className="annotation-loading">Loading annotations...</div>
            )}
            {annotationPopover && (
              <div
                className={`annotation-popover annotation-popover--${annotationPopover.placement}`}
                style={{
                  left: annotationPopover.x,
                  top: annotationPopover.y,
                }}
              >
                {annotationPopover.mode === "selection" && (
                  <button
                    className="annotation-selection-button"
                    onClick={beginCreate}
                  >
                    Annotate
                  </button>
                )}

                {annotationPopover.mode === "create" && (
                  <>
                    <div className="annotation-popover-title">New annotation</div>
                    <textarea
                      className="director-note-input annotation-popover-input"
                      autoFocus
                      value={annotationBody}
                      onChange={(e) => setAnnotationBody(e.target.value)}
                      rows={4}
                      placeholder="Write a note about this passage..."
                    />
                    <div className="annotation-popover-actions">
                      <button
                        className="action-btn"
                        onClick={cancelPopover}
                      >
                        Cancel
                      </button>
                      <button
                        className="action-btn btn--primary"
                        disabled={!annotationBody.trim()}
                        onClick={() => {
                          void createAnnotation().catch(console.error);
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </>
                )}

                {(annotationPopover.mode === "view" || annotationPopover.mode === "edit") && activeAnnotation && (
                  <>
                    <div className="annotation-popover-title">Annotation</div>
                    {annotationPopover.mode === "edit" ? (
                      <>
                        <textarea
                          className="director-note-input annotation-popover-input"
                          autoFocus
                          value={annotationBody}
                          onChange={(e) => setAnnotationBody(e.target.value)}
                          rows={4}
                        />
                        <div className="annotation-popover-actions">
                          <button
                            className="action-btn"
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                          <button
                            className="action-btn btn--primary"
                            disabled={!annotationBody.trim()}
                            onClick={() => {
                              void updateAnnotation().catch(console.error);
                            }}
                          >
                            Save
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="annotation-popover-body">{activeAnnotation.body}</div>
                        <div className="annotation-popover-actions">
                          <button
                            className="action-btn"
                            onClick={startEdit}
                          >
                            Edit
                          </button>
                          <button
                            className="action-btn"
                            onClick={() => {
                              void deleteAnnotation().catch(console.error);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
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

  return (
    <main className="reading-pane">
      <div className="reading-pane-scroll" ref={scrollRef}>
        <button className="icon-btn reading-pane-close" onClick={onClose} title="Close">&times;</button>
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

          {!loading && initialExpectation && (
            <section className="initial-expectation-section">
              <div className="studies-divider">
                <span>Your initial expectation</span>
              </div>
              <div className="initial-expectation-card">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {initialExpectation.body}
                </ReactMarkdown>
              </div>
            </section>
          )}

          {!loading && studies.length > 0 && (
            <section className="studies-section">
              <div className="studies-divider studies-divider--plain">
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

          {!loading && (
            <footer className="reading-pane-actions">
              <div className="action-buttons">
                <button
                  className="action-btn"
                  onClick={handleExport}
                  disabled={exporting}
                >
                  {exporting ? "Exporting..." : "Export"}
                </button>
                {idea.current_state === "done" ? (
                  <button
                    className="action-btn"
                    onClick={handleReopen}
                  >
                    Continue Researching
                  </button>
                ) : (
                  <button
                    className="action-btn"
                    onClick={handleMarkDone}
                  >
                    Mark Done
                  </button>
                )}
                <button
                  ref={resetBtnRef}
                  className="action-btn"
                  onClick={handleReset}
                >
                  {confirmReset ? "Confirm Reset" : "Reset"}
                </button>
                <button
                  ref={deleteBtnRef}
                  className="action-btn"
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
