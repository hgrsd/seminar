import { useState, useRef, useEffect } from "react";
import type { Worker, NavigationTarget } from "../types";
import { WORKER_TYPE_LABELS } from "../utils";
import { SearchModal } from "./SearchBar";

interface Props {
  workers: Worker[];
  paused: boolean;
  sessionCost: number;
  dark: boolean;
  onTogglePause: () => void;
  onToggleTheme: () => void;
  onWorkersClick: () => void;
  onSpawnWorker: (type: "initial_exploration" | "follow_up_research" | "connective_research") => void;
  onNewIdea: () => void;
  onNavigate: (target: NavigationTarget) => void;
}

export function TopBar({
  workers,
  paused,
  sessionCost,
  dark,
  onTogglePause,
  onToggleTheme,
  onWorkersClick,
  onSpawnWorker,
  onNewIdea,
  onNavigate,
}: Props) {
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!spawnOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setSpawnOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setSpawnOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [spawnOpen]);

  const isActive = (w: Worker) =>
    w.status === "researching";

  const activeCount = workers.filter(isActive).length;
  const idleCount = workers.length - activeCount;

  return (
    <header className="topbar">
      <div className="topbar-brand">Seminar</div>

      <button className="topbar-search-trigger" onClick={() => setSearchOpen(true)}>
        <svg className="topbar-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeWidth="1.5" />
          <line x1="10.75" y1="10.75" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="topbar-search-placeholder">Search ideas, studies, proposals...</span>
      </button>

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={onNavigate}
      />

      <button className="topbar-workers" onClick={onWorkersClick}>
        {sessionCost > 0 && (
          <span className="session-cost">${sessionCost.toFixed(2)}</span>
        )}
        <span className="worker-summary">
          {workers.length === 0
            ? "No workers"
            : `${activeCount} active\u2009·\u2009${idleCount} idle`}
        </span>
        <span className="topbar-workers-chevron">&rsaquo;</span>
      </button>

      <div className="topbar-actions">
        <button
          className={`topbar-btn topbar-btn--pause ${paused ? "topbar-btn--blink" : ""}`}
          onClick={onTogglePause}
          title={paused ? "Resume workers" : "Pause workers"}
        >
          {paused ? "\u25B6 Resume" : "\u23F8 Pause"}
        </button>
        <div className="spawn-dropdown" ref={dropdownRef}>
          <button
            className="topbar-btn"
            onClick={() => setSpawnOpen(!spawnOpen)}
            title="Spawn worker"
          >
            + Worker
          </button>
          {spawnOpen && (
            <div className="spawn-menu">
              {(["initial_exploration", "follow_up_research", "connective_research"] as const).map((type) => (
                <button
                  key={type}
                  className="spawn-menu-item"
                  onClick={() => {
                    onSpawnWorker(type);
                    setSpawnOpen(false);
                  }}
                >
                  {WORKER_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="topbar-btn topbar-btn--primary" onClick={onNewIdea}>
          + New Idea
        </button>
        <button
          className="topbar-theme-toggle"
          onClick={onToggleTheme}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {dark ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
              <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="8" y1="1" x2="8" y2="2.5" />
                <line x1="8" y1="13.5" x2="8" y2="15" />
                <line x1="1" y1="8" x2="2.5" y2="8" />
                <line x1="13.5" y1="8" x2="15" y2="8" />
                <line x1="3.05" y1="3.05" x2="4.11" y2="4.11" />
                <line x1="11.89" y1="11.89" x2="12.95" y2="12.95" />
                <line x1="3.05" y1="12.95" x2="4.11" y2="11.89" />
                <line x1="11.89" y1="4.11" x2="12.95" y2="3.05" />
              </g>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M14 9.5A6.5 6.5 0 0 1 6.5 2c0-.5.06-1 .17-1.47A7 7 0 1 0 14.47 9.33c-.15.1-.31.17-.47.17Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
