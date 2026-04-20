import { useCallback, useState, type MutableRefObject, type ReactNode, type RefObject } from "react";

export function CopyMarkdownButton({ content }: { content: string }) {
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

export function ReadingPaneFrame({
  children,
  onClose,
  scrollRef,
}: {
  children: ReactNode;
  onClose: () => void;
  scrollRef?: RefObject<HTMLDivElement | null> | MutableRefObject<HTMLDivElement | null>;
}) {
  return (
    <main className="reading-pane">
      <div className="reading-pane-scroll" ref={scrollRef}>
        <button className="icon-btn reading-pane-close" onClick={onClose} title="Close">&times;</button>
        <article className="reading-pane-content">{children}</article>
      </div>
    </main>
  );
}
