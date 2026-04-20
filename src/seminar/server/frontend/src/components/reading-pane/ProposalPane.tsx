import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useProposalDetail } from "../../hooks/useProposalDetail";
import { useProposals } from "../../hooks/useProposals";
import type { NavigationTarget, Proposal } from "../../types";
import { relativeTime } from "../../utils";
import { CopyMarkdownButton, ReadingPaneFrame } from "./ReadingPaneCommon";

interface Props {
  proposal: Proposal;
  onNavigate: (target: NavigationTarget) => void;
  onClose: () => void;
}

export function ProposalPane({ proposal, onNavigate, onClose }: Props) {
  const { approveProposal, rejectProposal, deleteProposal } = useProposals();
  const { content, meta, isLoading } = useProposalDetail(proposal.slug);
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteBtnRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConfirmReject(false);
    setConfirmDelete(false);
  }, [proposal.slug]);

  useEffect(() => {
    if (!confirmDelete) return;
    const handleClick = (event: MouseEvent) => {
      if (deleteBtnRef.current && !deleteBtnRef.current.contains(event.target as Node)) {
        setConfirmDelete(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [confirmDelete]);

  const handleApprove = () => {
    void approveProposal(proposal.slug);
  };

  const handleReject = () => {
    if (!confirmReject) {
      setConfirmReject(true);
      return;
    }
    void rejectProposal(proposal.slug);
    setConfirmReject(false);
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    void deleteProposal(proposal.slug);
    setConfirmDelete(false);
    onClose();
  };

  return (
    <ReadingPaneFrame onClose={onClose} scrollRef={scrollRef}>
      <header className="reading-pane-header">
        <h1 className="reading-pane-title">{proposal.title}</h1>
        <div className="reading-pane-meta">
          <span className="state-badge state-badge--proposed">
            {proposal.status === "pending" ? "Proposed" : "Rejected"}
          </span>
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

      {proposal.sources.length > 0 && (
        <div className="pedigree">
          <div className="pedigree-group">
            <span className="pedigree-label">Derived from</span>
            {proposal.sources.map((slug) => (
              <button key={slug} className="pedigree-link" onClick={() => onNavigate({ type: "idea", slug })}>
                {slug}
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading && <div className="reading-pane-loading">Loading...</div>}

      {!isLoading && content && (
        <div className="prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}

      {!isLoading && proposal.status === "pending" && (
        <footer className="reading-pane-actions">
          <div className="action-buttons">
            <button className="action-btn btn--primary" onClick={handleApprove}>
              Approve
            </button>
            <button className="action-btn" onClick={handleReject}>
              {confirmReject ? "Confirm Reject" : "Reject"}
            </button>
          </div>
          <p className="action-hint">
            Approve creates a new idea and queues it for research. Reject discards the proposal.
          </p>
        </footer>
      )}

      {!isLoading && proposal.status === "rejected" && (
        <footer className="reading-pane-actions">
          <div className="action-buttons">
            <button ref={deleteBtnRef} className="action-btn" onClick={handleDelete}>
              {confirmDelete ? "Confirm Delete" : "Delete"}
            </button>
          </div>
          <p className="action-hint">
            Delete removes the rejected proposal entirely.
          </p>
        </footer>
      )}
    </ReadingPaneFrame>
  );
}
