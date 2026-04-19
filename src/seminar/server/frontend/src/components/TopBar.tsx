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
  onNewThread: () => void;
  onOpenSettings: () => void;
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
  onNewThread,
  onOpenSettings,
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
        <span className="topbar-search-placeholder">Search ideas, studies, proposals, threads...</span>
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
        <button className="topbar-btn" onClick={onNewThread}>
          + Thread
        </button>
        <button
          className="icon-btn topbar-theme-toggle"
          onClick={onOpenSettings}
          title="Open settings"
          aria-label="Open settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path fillRule="evenodd" d="M16 12a4 4 0 11-8 0 4 4 0 018 0zM12 1c-.268 0-.534.01-.797.028-.763.055-1.345.617-1.512 1.304l-.352 1.45c-.02.078-.09.172-.225.22a8.45 8.45 0 00-.728.303c-.13.06-.246.044-.315.002l-1.274-.776c-.604-.368-1.412-.354-1.99.147-.403.348-.78.726-1.129 1.128-.5.579-.515 1.387-.147 1.99l.776 1.275c.042.069.059.185-.002.315-.112.237-.213.48-.302.728-.05.135-.143.206-.221.225l-1.45.352c-.687.167-1.249.749-1.304 1.512a11.149 11.149 0 000 1.594c.055.763.617 1.345 1.304 1.512l1.45.352c.078.02.172.09.22.225.09.248.191.491.303.729.06.129.044.245.002.314l-.776 1.274c-.368.604-.354 1.412.147 1.99.348.403.726.78 1.128 1.129.579.5 1.387.515 1.99.147l1.275-.776c.069-.042.185-.059.315.002.237.112.48.213.728.302.135.05.206.143.225.221l.352 1.45c.167.687.749 1.249 1.512 1.303a11.125 11.125 0 001.594 0c.763-.054 1.345-.616 1.512-1.303l.352-1.45c.02-.078.09-.172.225-.22.248-.09.491-.191.729-.303.129-.06.245-.044.314-.002l1.274.776c.604.368 1.412.354 1.99-.147.403-.348.78-.726 1.129-1.128.5-.579.515-1.387.147-1.99l-.776-1.275c-.042-.069-.059-.185.002-.315.112-.237.213-.48.302-.728.05-.135.143-.206.221-.225l1.45-.352c.687-.167 1.249-.749 1.303-1.512a11.125 11.125 0 000-1.594c-.054-.763-.616-1.345-1.303-1.512l-1.45-.352c-.078-.02-.172-.09-.22-.225a8.469 8.469 0 00-.303-.728c-.06-.13-.044-.246-.002-.315l.776-1.274c.368-.604.354-1.412-.147-1.99-.348-.403-.726-.78-1.128-1.129-.579-.5-1.387-.515-1.99-.147l-1.275.776c-.069.042-.185.059-.315-.002a8.465 8.465 0 00-.728-.302c-.135-.05-.206-.143-.225-.221l-.352-1.45c-.167-.687-.749-1.249-1.512-1.304A11.149 11.149 0 0012 1z"/>
          </svg>
        </button>
        <button
          className="icon-btn topbar-theme-toggle"
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
