import { useEffect, useRef, useState } from "react";
import { useThreads } from "../hooks/useThreads";

interface Props {
  onClose: () => void;
  ideaSlug?: string | null;
  initialTitle?: string;
}

export function NewThreadModal({ onClose, ideaSlug = null, initialTitle = "" }: Props) {
  const { createThread } = useThreads();
  const [title, setTitle] = useState(initialTitle);
  const [authorName, setAuthorName] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !authorName.trim() || !body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createThread({
        title: title.trim(),
        body,
        author_name: authorName.trim(),
        idea_slug: ideaSlug ?? undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  return (
    <div className="modal-backdrop" ref={backdropRef} onClick={handleBackdropClick}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{ideaSlug ? "New Idea Thread" : "New Thread"}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-field">
            <label className="modal-label" htmlFor="thread-title">Title</label>
            <input
              id="thread-title"
              ref={titleRef}
              type="text"
              className="modal-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          {ideaSlug && (
            <div className="modal-note">This thread will be linked to `{ideaSlug}`.</div>
          )}
          <div className="modal-field">
            <label className="modal-label" htmlFor="thread-author">Author</label>
            <input
              id="thread-author"
              type="text"
              className="modal-input"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
            />
          </div>
          <div className="modal-field">
            <label className="modal-label" htmlFor="thread-body">Message</label>
            <textarea
              id="thread-body"
              className="modal-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
            />
          </div>
          {error && <div className="modal-error">{error}</div>}
          <div className="modal-actions">
            <button className="action-btn" type="button" onClick={onClose}>Cancel</button>
            <button className="action-btn btn--primary" type="submit" disabled={submitting}>
              {submitting ? "Sending..." : "Start Thread"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
