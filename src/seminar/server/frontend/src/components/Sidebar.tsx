import { useState, useMemo, useCallback, useEffect } from "react";
import type { Idea, Worker, StudyFile, Proposal, Message, NavigationTarget } from "../types";
import { stateGroup, WORKER_TYPE_COLORS } from "../utils";

interface Props {
  ideas: Idea[];
  proposals: Proposal[];
  messages: Message[];
  activeWorkers: Map<string, Worker>;
  selectedSlug: string | null;
  selectedStudy: number | null;
  selectedProposal: string | null;
  selectedMessage: number | null;
  studyCounts: Record<string, number>;
  studiesCache: Record<string, StudyFile[]>;
  fetchStudies: (slug: string) => void;
  onNavigate: (target: NavigationTarget) => void;
  onCollapse: () => void;
}

interface SectionConfig {
  key: "not_started" | "active" | "done";
  label: string;
}

const SECTIONS: SectionConfig[] = [
  { key: "not_started", label: "Unexplored" },
  { key: "active", label: "Exploring" },
  { key: "done", label: "Well-understood" },
];

const ALL_SECTION_KEYS = ["inbox", "inbox_unread", "inbox_read", "rejected_proposals", "not_started", "active", "done"];

type SortField = "name" | "created" | "activity";
type SortDir = "asc" | "desc";
type SortState = { field: SortField; dir: SortDir } | null;

function compareIdeas(a: Idea, b: Idea, field: SortField, activeSlugs: Set<string>): number {
  switch (field) {
    case "name":
      return a.title.localeCompare(b.title);
    case "created":
      return a.recorded_at.localeCompare(b.recorded_at);
    case "activity": {
      const aActive = activeSlugs.has(a.slug) ? 0 : 1;
      const bActive = activeSlugs.has(b.slug) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return (a.last_studied ?? "").localeCompare(b.last_studied ?? "");
    }
  }
}

function sortIdeas(ideas: Idea[], sort: SortState, activeSlugs: Set<string>): Idea[] {
  if (!sort) return ideas;
  const flip = sort.dir === "desc" ? -1 : 1;
  return [...ideas].sort((a, b) => flip * compareIdeas(a, b, sort.field, activeSlugs));
}

export function Sidebar({ ideas, proposals, messages, activeWorkers, selectedSlug, selectedStudy, selectedProposal, selectedMessage, studyCounts, studiesCache, fetchStudies, onNavigate, onCollapse }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    inbox: true,
    inbox_unread: false,
    inbox_read: true,
    rejected_proposals: true,
    not_started: true,
    active: true,
    done: true,
  });
  const [expandedIdeas, setExpandedIdeas] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<SortState>({ field: "name", dir: "asc" });

  const activeSlugs = useMemo(() => new Set(activeWorkers.keys()), [activeWorkers]);

  const grouped = useMemo(() => {
    const groups: Record<string, Idea[]> = {
      not_started: [],
      active: [],
      done: [],
    };
    for (const idea of ideas) {
      const group = activeSlugs.has(idea.slug) && stateGroup(idea.current_state) === "not_started"
        ? "active"
        : stateGroup(idea.current_state);
      groups[group].push(idea);
    }
    for (const key of Object.keys(groups)) {
      groups[key] = sortIdeas(groups[key], sort, activeSlugs);
    }
    return groups;
  }, [ideas, activeSlugs, sort]);

  useEffect(() => {
    if (!selectedSlug || !selectedStudy) return;
    if (expandedIdeas[selectedSlug]) return;
    setExpandedIdeas((prev) => ({ ...prev, [selectedSlug]: true }));
    if (!studiesCache[selectedSlug]) {
      fetchStudies(selectedSlug);
    }
  }, [selectedSlug, selectedStudy]);

  useEffect(() => {
    if (selectedProposal) {
      const selected = proposals.find((proposal) => proposal.slug === selectedProposal);
      if (!selected) return;
      setCollapsed((prev) => selected.status === "rejected"
        ? { ...prev, rejected_proposals: false }
        : { ...prev, inbox: false, inbox_unread: false });
      return;
    }
    if (!selectedMessage) return;
    const selected = messages.find((message) => message.id === selectedMessage);
    if (!selected) return;
    setCollapsed((prev) => ({
      ...prev,
      inbox: false,
      [selected.status === "read" ? "inbox_read" : "inbox_unread"]: false,
    }));
  }, [messages, proposals, selectedMessage, selectedProposal]);

  const toggleAllSections = (expand: boolean) => {
    setCollapsed(Object.fromEntries(ALL_SECTION_KEYS.map((k) => [k, !expand])));
    if (!expand) {
      setExpandedIdeas({});
    }
  };

  const toggleSection = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleIdeaStudies = useCallback((slug: string) => {
    const isExpanded = expandedIdeas[slug] ?? false;
    setExpandedIdeas((prev) => ({ ...prev, [slug]: !isExpanded }));
    if (!isExpanded) {
      fetchStudies(slug);
    }
  }, [expandedIdeas, fetchStudies]);

  const handleIdeaClick = useCallback((slug: string) => {
    onNavigate({ type: "idea", slug });
    toggleIdeaStudies(slug);
  }, [onNavigate, toggleIdeaStudies]);

  return (
    <aside className="sidebar">
      <div className="sidebar-sort-bar">
        {([["name", "A-Z"], ["created", "New"], ["activity", "Active"]] as const).map(([field, label]) => {
          const active = sort?.field === field;
          const arrow = active ? (sort.dir === "asc" ? " \u2193" : " \u2191") : "";
          return (
            <button
              key={field}
              className={`sidebar-sort-btn ${active ? "sidebar-sort-btn--active" : ""}`}
              onClick={() => setSort((prev) => {
                if (prev?.field !== field) return { field, dir: "asc" };
                if (prev.dir === "asc") return { field, dir: "desc" };
                return null;
              })}
            >
              {label}{arrow}
            </button>
          );
        })}
        <button className="icon-btn sidebar-collapse-btn" onClick={() => toggleAllSections(true)} title="Expand all">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <polyline points="4,6 8,2 12,6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="4,10 8,14 12,10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="icon-btn sidebar-collapse-btn" onClick={() => toggleAllSections(false)} title="Collapse all">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <polyline points="4,2 8,6 12,2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="4,14 8,10 12,14" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="sidebar-sections">
        {/* Inbox: pending proposals + messages */}
        {(() => {
          const pendingProposals = proposals.filter((p) => p.status === "pending");
          const unreadMessages = messages.filter((m) => m.status === "unread");
          const readMessages = messages.filter((m) => m.status === "read");
          const unreadCount = pendingProposals.length + unreadMessages.length;
          const readCount = readMessages.length;
          const inboxHasItems = unreadCount + readCount > 0;
          const isCollapsed = collapsed.inbox ?? false;
          const isUnreadCollapsed = collapsed.inbox_unread ?? false;
          const isReadCollapsed = collapsed.inbox_read ?? false;

          type MessageInboxItem =
            | { kind: "proposal"; recorded_at: string; proposal: Proposal }
            | { kind: "message"; recorded_at: string; message: Message };

          const unreadItems: MessageInboxItem[] = [
            ...pendingProposals.map((p) => ({ kind: "proposal" as const, recorded_at: p.recorded_at, proposal: p })),
            ...unreadMessages.map((m) => ({ kind: "message" as const, recorded_at: m.recorded_at, message: m })),
          ].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
          const readItems: MessageInboxItem[] = readMessages
            .map((m) => ({ kind: "message" as const, recorded_at: m.recorded_at, message: m }))
            .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));

          const renderInboxItem = (item: MessageInboxItem) => item.kind === "proposal" ? (
            <button
              key={`proposal-${item.proposal.slug}`}
              id={`sidebar-proposal-${item.proposal.slug}`}
              className={`sidebar-study-item ${item.proposal.slug === selectedProposal ? "sidebar-study-item--selected" : ""}`}
              onClick={() => onNavigate({ type: "proposal", slug: item.proposal.slug })}
            >
              <span className="sidebar-study-name">{item.proposal.title}</span>
              <span className="state-badge">proposal</span>
            </button>
          ) : (
            <button
              key={`message-${item.message.id}`}
              id={`sidebar-message-${item.message.id}`}
              className={`sidebar-study-item ${item.message.id === selectedMessage ? "sidebar-study-item--selected" : ""}`}
              onClick={() => onNavigate({ type: "message", id: item.message.id })}
            >
              <span className="sidebar-study-name">{item.message.title}</span>
            </button>
          );

          return (
            <div className="sidebar-section">
              <button
                className={`sidebar-section-header ${!inboxHasItems ? "sidebar-section-header--empty" : ""}`}
                onClick={() => inboxHasItems && toggleSection("inbox")}
              >
                <span className="sidebar-section-arrow">
                  {!inboxHasItems ? "" : isCollapsed ? "\u25B8" : "\u25BE"}
                </span>
                <span className="sidebar-section-label">Inbox</span>
                <span className={`sidebar-section-count ${unreadCount > 0 ? "sidebar-section-count--inbox" : ""}`}>{unreadCount}</span>
              </button>
              {!isCollapsed && (
                <div className="sidebar-section-items">
                  <div className="sidebar-subsection">
                    <button
                      className={`sidebar-item sidebar-subsection-header ${unreadCount === 0 ? "sidebar-subsection-header--empty" : ""}`}
                      onClick={() => unreadCount > 0 && toggleSection("inbox_unread")}
                    >
                      <span className="sidebar-item-dot" />
                      <span className="sidebar-item-name">Unread</span>
                      <span className="sidebar-item-count">({unreadCount})</span>
                      <span className="sidebar-item-arrow sidebar-subsection-arrow">
                        {unreadCount === 0 ? "" : isUnreadCollapsed ? "\u25B8" : "\u25BE"}
                      </span>
                    </button>
                    {!isUnreadCollapsed && unreadItems.length > 0 && (
                      <div className="sidebar-subsection-items">
                        {unreadItems.map(renderInboxItem)}
                      </div>
                    )}
                  </div>
                  <div className="sidebar-subsection">
                    <button
                      className={`sidebar-item sidebar-subsection-header ${readCount === 0 ? "sidebar-subsection-header--empty" : ""}`}
                      onClick={() => readCount > 0 && toggleSection("inbox_read")}
                    >
                      <span className="sidebar-item-dot" />
                      <span className="sidebar-item-name">Read</span>
                      <span className="sidebar-item-count">({readCount})</span>
                      <span className="sidebar-item-arrow sidebar-subsection-arrow">
                        {readCount === 0 ? "" : isReadCollapsed ? "\u25B8" : "\u25BE"}
                      </span>
                    </button>
                    {!isReadCollapsed && readItems.length > 0 && (
                      <div className="sidebar-subsection-items">
                        {readItems.map(renderInboxItem)}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Idea sections: Unexplored, Exploring, Well-understood */}
        {SECTIONS.map(({ key, label }) => {
          const items = grouped[key];
          const isCollapsed = collapsed[key] ?? false;

          return (
            <div key={key} className="sidebar-section">
              <button
                className={`sidebar-section-header ${items.length === 0 ? "sidebar-section-header--empty" : ""}`}
                onClick={() => items.length > 0 && toggleSection(key)}
              >
                <span className="sidebar-section-arrow">
                  {items.length === 0 ? "" : isCollapsed ? "\u25B8" : "\u25BE"}
                </span>
                <span className="sidebar-section-label">{label}</span>
                <span className="sidebar-section-count">{items.length}</span>
              </button>

              {!isCollapsed && (
                <div className="sidebar-section-items">
                  {items.map((idea) => {
                    const isExpanded = expandedIdeas[idea.slug] ?? false;
                    const studies = studiesCache[idea.slug] ?? [];
                    const isIdeaSelected = idea.slug === selectedSlug && !selectedStudy;

                    return (
                      <div key={idea.slug}>
                        <button
                          id={`sidebar-idea-${idea.slug}`}
                          className={`sidebar-item ${isIdeaSelected ? "sidebar-item--selected" : ""}`}
                          onClick={() => handleIdeaClick(idea.slug)}
                        >
                          <span
                            className={`sidebar-item-dot ${activeSlugs.has(idea.slug) ? "sidebar-item-dot--active" : ""}`}
                            style={activeSlugs.has(idea.slug) ? { background: WORKER_TYPE_COLORS[activeWorkers.get(idea.slug)!.type] } : undefined}
                          />
                          <span className="sidebar-item-name">
                            {idea.title}
                          </span>
                          {(studyCounts[idea.slug] > 0 || studies.length > 0) && (
                            <>
                              <span className="sidebar-item-count">({studyCounts[idea.slug] ?? studies.length})</span>
                              <span className="sidebar-item-arrow">{isExpanded ? "\u25BE" : "\u25B8"}</span>
                            </>
                          )}
                        </button>

                        {isExpanded && studies.map((study) => (
                          <button
                            key={study.study_number}
                            id={`sidebar-study-${idea.slug}-${study.study_number}`}
                            className={`sidebar-study-item ${idea.slug === selectedSlug && study.study_number === selectedStudy ? "sidebar-study-item--selected" : ""}`}
                            onClick={() => onNavigate({ type: "study", slug: idea.slug, study_number: study.study_number })}
                          >
                            <span className="sidebar-study-name">{study.title}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {(() => {
          const rejectedProposals = proposals
            .filter((p) => p.status === "rejected")
            .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
          const isCollapsed = collapsed.rejected_proposals ?? false;

          return (
            <div className="sidebar-section">
              <button
                className={`sidebar-section-header ${rejectedProposals.length === 0 ? "sidebar-section-header--empty" : ""}`}
                onClick={() => rejectedProposals.length > 0 && toggleSection("rejected_proposals")}
              >
                <span className="sidebar-section-arrow">
                  {rejectedProposals.length === 0 ? "" : isCollapsed ? "\u25B8" : "\u25BE"}
                </span>
                <span className="sidebar-section-label">Rejected Proposals</span>
                <span className="sidebar-section-count">{rejectedProposals.length}</span>
              </button>
              {!isCollapsed && rejectedProposals.length > 0 && (
                <div className="sidebar-section-items">
                  {rejectedProposals.map((proposal) => (
                    <button
                      key={`rejected-proposal-${proposal.slug}`}
                      id={`sidebar-rejected-proposal-${proposal.slug}`}
                      className={`sidebar-study-item ${proposal.slug === selectedProposal ? "sidebar-study-item--selected" : ""}`}
                      onClick={() => onNavigate({ type: "proposal", slug: proposal.slug })}
                    >
                      <span className="sidebar-study-name">{proposal.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

      </div>
      <div className="sidebar-bottom">
        <button
          className="icon-btn sidebar-collapse-btn"
          onClick={onCollapse}
          title="Hide sidebar"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="2" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <line x1="10" y1="2" x2="10" y2="14" stroke="currentColor" strokeWidth="1.5" />
            <polyline points="6.5,6.5 4.5,8 6.5,9.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
