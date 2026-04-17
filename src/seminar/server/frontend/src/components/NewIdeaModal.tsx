import { useState, useRef, useEffect } from "react";
import { useIdeas } from "../hooks/useIdeas";

interface Props {
  onClose: () => void;
}

export function NewIdeaModal({ onClose }: Props) {
  const { createIdea } = useIdeas();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [author, setAuthor] = useState("");
  const [content, setContent] = useState("");
  const [initialExpectation, setInitialExpectation] = useState("");
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

  const deriveSlug = (t: string) =>
    t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (!slug || slug === deriveSlug(title)) {
      setSlug(deriveSlug(value));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedSlug = slug.trim();
    if (!trimmedTitle || !trimmedSlug || !author.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      await createIdea({
        title: trimmedTitle,
        slug: trimmedSlug,
        author: author.trim(),
        body: content || `# ${trimmedTitle}\n`,
        initial_expectation: initialExpectation,
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
    <div
      className="modal-backdrop"
      ref={backdropRef}
      onClick={handleBackdropClick}
    >
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">New Idea</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-field">
            <label className="modal-label" htmlFor="idea-title">
              Title
            </label>
            <input
              id="idea-title"
              ref={titleRef}
              type="text"
              className="modal-input"
              placeholder="My Research Idea"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
            />
          </div>
          <div className="modal-field">
            <label className="modal-label" htmlFor="idea-slug">
              Slug
            </label>
            <input
              id="idea-slug"
              type="text"
              className="modal-input"
              placeholder="my-research-idea"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
          <div className="modal-field">
            <label className="modal-label" htmlFor="idea-author">
              Author
            </label>
            <input
              id="idea-author"
              type="text"
              className="modal-input"
              placeholder="Your name"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
          <div className="modal-field">
            <label className="modal-label" htmlFor="idea-content">
              Content (markdown)
            </label>
            <textarea
              id="idea-content"
              className="modal-textarea"
              placeholder="Describe the idea..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={14}
            />
          </div>
          <div className="modal-field">
            <label className="modal-label" htmlFor="idea-initial-expectation">
              What do you expect the research to find?
            </label>
            <textarea
              id="idea-initial-expectation"
              className="modal-textarea modal-textarea--compact"
              placeholder="Optional. Write what you currently expect the research to find."
              value={initialExpectation}
              onChange={(e) => setInitialExpectation(e.target.value)}
              rows={4}
            />
            <div className="modal-note">
              Record your starting view before Seminar begins researching. That keeps your own thinking in the loop and gives the final synthesis a real baseline to compare against, rather than relying on hindsight.
            </div>
          </div>
          {error && <div className="modal-error">{error}</div>}
          <div className="modal-actions">
            <button
              type="button"
              className="action-btn"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="action-btn btn--primary"
              disabled={submitting || !title.trim() || !slug.trim() || !author.trim()}
            >
              {submitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
