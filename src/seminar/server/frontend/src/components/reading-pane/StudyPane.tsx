import { useEffect, useMemo, useRef, isValidElement, type ReactElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useIdeaDetail } from "../../hooks/useIdeaDetail";
import { useStudyAnnotations } from "../../hooks/useStudyAnnotations";
import type { Idea } from "../../types";
import { relativeTime, studyModeLabel } from "../../utils";
import { CopyMarkdownButton, ReadingPaneFrame } from "./ReadingPaneCommon";

interface TocEntry {
  level: number;
  text: string;
  id: string;
}

function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (!match) continue;
    const text = match[2].trim().replace(/`/g, "");
    const id = text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
    entries.push({ level: match[1].length, text, id });
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

function HeadingWithId({
  level,
  children,
  scrollRef,
  ...props
}: {
  level: number;
  children?: ReactNode;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
} & React.HTMLAttributes<HTMLHeadingElement>) {
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
    const element = container.querySelector(`#${CSS.escape(id)}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
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
  idea: Idea;
  selectedStudy: number;
  scrollToAnnotationId: number | null;
  onScrollToAnnotationHandled: () => void;
  onNavigate: (target: { type: "idea"; slug: string }) => void;
  onClose: () => void;
}

export function StudyPane({
  idea,
  selectedStudy,
  scrollToAnnotationId,
  onScrollToAnnotationHandled,
  onNavigate,
  onClose,
}: Props) {
  const { studies, title } = useIdeaDetail(idea.slug);
  const activeStudy = studies.find((study) => study.study_number === selectedStudy) ?? null;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [selectedStudy]);

  const tocEntries = useMemo(
    () => (activeStudy?.content ? extractToc(activeStudy.content) : []),
    [activeStudy?.content],
  );
  const mdComponents = useMemo(() => makeHeadingComponents(scrollRef), []);
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
    idea.slug,
    selectedStudy,
    activeStudy?.content,
    scrollToAnnotationId,
    onScrollToAnnotationHandled,
  );

  return (
    <ReadingPaneFrame onClose={onClose} scrollRef={scrollRef}>
      <button className="reading-pane-back" onClick={() => onNavigate({ type: "idea", slug: idea.slug })}>
        &larr; {title ?? idea.title}
      </button>
      {activeStudy ? (
        <>
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
              style={{ left: annotationPopover.x, top: annotationPopover.y }}
            >
              {annotationPopover.mode === "selection" && (
                <button className="annotation-selection-button" onClick={beginCreate}>
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
                    onChange={(event) => setAnnotationBody(event.target.value)}
                    rows={4}
                    placeholder="Write a note about this passage..."
                  />
                  <div className="annotation-popover-actions">
                    <button className="action-btn" onClick={cancelPopover}>
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
                        onChange={(event) => setAnnotationBody(event.target.value)}
                        rows={4}
                      />
                      <div className="annotation-popover-actions">
                        <button className="action-btn" onClick={cancelEdit}>
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
                        <button className="action-btn" onClick={startEdit}>
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
        </>
      ) : (
        <div className="reading-pane-loading">Loading...</div>
      )}
    </ReadingPaneFrame>
  );
}
