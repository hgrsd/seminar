import { useState, useMemo, useCallback, useEffect } from "react";
import type { Idea, Worker, StudyFile, Proposal, NavigationTarget } from "../types";
import { stateGroup, WORKER_TYPE_COLORS } from "../utils";

interface Props {
  ideas: Idea[];
  proposals: Proposal[];
  activeWorkers: Map<string, Worker>;
  selectedSlug: string | null;
  selectedStudy: number | null;
  selectedProposal: string | null;
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

const ALL_SECTION_KEYS = ["proposed", "not_started", "active", "done", "rejected"];

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

export function Sidebar({ ideas, proposals, activeWorkers, selectedSlug, selectedStudy, selectedProposal, studyCounts, studiesCache, fetchStudies, onNavigate, onCollapse }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ proposed: true, not_started: true, active: true, done: true, rejected: true });
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
        {/* Proposed */}
        {(() => {
          const items = proposals.filter((p) => p.status === "pending");
          const isCollapsed = collapsed["proposed"] ?? false;
          return (
            <div className="sidebar-section">
              <button
                className={`sidebar-section-header ${items.length === 0 ? "sidebar-section-header--empty" : ""}`}
                onClick={() => items.length > 0 && toggleSection("proposed")}
              >
                <span className="sidebar-section-arrow">
                  {items.length === 0 ? "" : isCollapsed ? "\u25B8" : "\u25BE"}
                </span>
                <span className="sidebar-section-label">Proposed</span>
                <span className={`sidebar-section-count ${items.length > 0 ? "sidebar-section-count--proposed" : ""}`}>{items.length}</span>
              </button>
              {!isCollapsed && (
                <div className="sidebar-section-items">
                  {items.map((p) => (
                    <button
                      key={p.slug}
                      id={`sidebar-proposal-${p.slug}`}
                      className={`sidebar-item ${p.slug === selectedProposal ? "sidebar-item--selected" : ""}`}
                      onClick={() => onNavigate({ type: "proposal", slug: p.slug })}
                    >
                      <span className="sidebar-item-dot" />
                      <span className="sidebar-item-name">{p.title}</span>
                    </button>
                  ))}
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

        {/* Rejected */}
        {(() => {
          const items = proposals.filter((p) => p.status === "rejected");
          const isCollapsed = collapsed["rejected"] ?? false;
          return (
            <div className="sidebar-section">
              <button
                className={`sidebar-section-header ${items.length === 0 ? "sidebar-section-header--empty" : ""}`}
                onClick={() => items.length > 0 && toggleSection("rejected")}
              >
                <span className="sidebar-section-arrow">
                  {items.length === 0 ? "" : isCollapsed ? "\u25B8" : "\u25BE"}
                </span>
                <span className="sidebar-section-label">Rejected</span>
                <span className="sidebar-section-count">{items.length}</span>
              </button>
              {!isCollapsed && (
                <div className="sidebar-section-items">
                  {items.map((p) => (
                    <button
                      key={p.slug}
                      id={`sidebar-proposal-${p.slug}`}
                      className={`sidebar-item ${p.slug === selectedProposal ? "sidebar-item--selected" : ""}`}
                      onClick={() => onNavigate({ type: "proposal", slug: p.slug })}
                    >
                      <span className="sidebar-item-dot" />
                      <span className="sidebar-item-name">{p.title}</span>
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
