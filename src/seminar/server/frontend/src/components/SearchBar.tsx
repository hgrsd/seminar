import { useState, useRef, useEffect, useCallback } from "react";
import type { NavigationTarget } from "../types";

interface SearchResult {
  type: "idea" | "study" | "proposal" | "annotation";
  slug: string;
  title: string;
  snippet: string;
  study_number?: number;
  annotation_id?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (target: NavigationTarget) => void;
}

const TYPE_LABELS: Record<string, string> = {
  idea: "Idea",
  study: "Study",
  proposal: "Proposal",
  annotation: "Annotation",
};

const TYPE_COLORS: Record<string, string> = {
  idea: "var(--amber)",
  study: "var(--violet)",
  proposal: "var(--green)",
  annotation: "var(--grey)",
};

function Highlight({ text, query }: { text: string; query: string }) {
  if (query.length < 2) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? <mark key={i} className="search-highlight">{part}</mark> : part
      )}
    </>
  );
}

export function SearchModal({ open, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const doSearch = useCallback((q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((data: SearchResult[]) => {
        setResults(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    clearTimeout(timerRef.current);
    if (value.length < 2) {
      setResults([]);
      return;
    }
    timerRef.current = setTimeout(() => doSearch(value), 300);
  };

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
    return () => clearTimeout(timerRef.current);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  const handleSelect = (result: SearchResult) => {
    onClose();
    if (result.type === "idea") {
      onNavigate({ type: "idea", slug: result.slug });
    } else if (result.type === "study" && result.study_number != null) {
      onNavigate({ type: "study", slug: result.slug, study_number: result.study_number });
    } else if (result.type === "proposal") {
      onNavigate({ type: "proposal", slug: result.slug });
    } else if (result.type === "annotation" && result.study_number != null && result.annotation_id != null) {
      onNavigate({ type: "annotation", slug: result.slug, study_number: result.study_number, annotation_id: result.annotation_id });
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="search-modal">
        <input
          ref={inputRef}
          className="search-modal-input"
          type="text"
          placeholder="Search ideas, studies, proposals..."
          value={query}
          onChange={(e) => handleChange(e.target.value)}
        />
        <div className="search-modal-results">
          {loading && results.length === 0 && (
            <div className="search-empty">Searching...</div>
          )}
          {!loading && results.length === 0 && query.length >= 2 && (
            <div className="search-empty">No results</div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.slug}-${r.study_number ?? ""}-${i}`}
              className="search-result"
              onClick={() => handleSelect(r)}
            >
              <span className="search-result-badge" style={{ background: TYPE_COLORS[r.type] }}>
                {TYPE_LABELS[r.type]}
              </span>
              <span className="search-result-title"><Highlight text={r.title || r.slug} query={query} /></span>
              {r.snippet && (
                <span className="search-result-snippet"><Highlight text={r.snippet} query={query} /></span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
