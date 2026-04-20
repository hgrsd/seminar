import { useNavigate, useOutletContext } from "react-router-dom";
import { ReadingPane } from "../components/ReadingPane";
import { useWorkers } from "../hooks/useWorkers";
import { useActiveWorkers } from "../hooks/useActiveWorkers";
import type { AppLayoutContext } from "./AppLayout";

export function EmptyDetailRoute() {
  const navigate = useNavigate();
  const { workers } = useWorkers();
  const activeWorkers = useActiveWorkers(workers);
  const context = useOutletContext<AppLayoutContext>();

  return (
    <ReadingPane
      selection={{ kind: "empty" }}
      activeWorkers={activeWorkers}
      onWorkerClick={(workerId) => navigate(`/workers/${workerId}`)}
      onNavigate={context.navigateToTarget}
      onStartThread={(ideaSlug, initialTitle) => context.openNewThread(ideaSlug, initialTitle)}
      onClose={() => {}}
    />
  );
}
