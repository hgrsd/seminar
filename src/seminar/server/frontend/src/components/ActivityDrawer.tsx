import { useState, useEffect, useRef } from "react";
import type { ActivityEvent, NavigationTarget, Worker } from "../types";
import { formatTimestamp } from "../utils";

interface Props {
  activity: ActivityEvent[];
  workers: Worker[];
  onWorkerClick: (workerId: number) => void;
  onNavigate: (target: NavigationTarget) => void;
}

function navTarget(event: ActivityEvent): NavigationTarget | null {
  if (event.thread_id != null) {
    return { type: "thread", id: event.thread_id };
  }
  if (event.proposal_slug) {
    return { type: "proposal", slug: event.proposal_slug };
  }
  if (event.slug) {
    return { type: "idea", slug: event.slug };
  }
  return null;
}

export function ActivityDrawer({ activity, workers, onWorkerClick, onNavigate }: Props) {
  const workerIds = new Set(workers.map((w) => w.id));
  const [expanded, setExpanded] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };

    document.addEventListener("keydown", handleEsc);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [expanded]);

  const latest = activity[0];

  return (
    <div
      ref={drawerRef}
      className={`activity-drawer ${expanded ? "activity-drawer--expanded" : ""}`}
    >
      <button
        className="activity-drawer-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="activity-drawer-label">Activity</span>
        {latest && !expanded && (
          <span className="activity-drawer-latest">
            <span className="activity-ts">
              {formatTimestamp(latest.ts)}
            </span>
            {latest.message}
          </span>
        )}
      </button>

      {expanded && (
        <div className="activity-drawer-body">
          {activity.map((event, i) => {
            const target = navTarget(event);
            const hasWorker = event.worker_id != null && workerIds.has(event.worker_id);
            const clickable = target || hasWorker;
            return (
              <div
                key={`${event.ts}-${i}`}
                className={`activity-event ${clickable ? "activity-event--clickable" : ""}`}
                onClick={target ? () => onNavigate(target) : hasWorker ? () => onWorkerClick(event.worker_id!) : undefined}
              >
                <span className="activity-ts">
                  {formatTimestamp(event.ts)}
                </span>
                <span className="activity-message">{event.message}</span>
              </div>
            );
          })}
          {activity.length === 0 && (
            <div className="activity-empty">No activity yet</div>
          )}
        </div>
      )}
    </div>
  );
}
