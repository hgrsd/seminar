import { useNavigate, useOutletContext } from "react-router-dom";
import { ReadingPane } from "../components/ReadingPane";
import type { AppLayoutContext } from "./AppLayout";

export function EmptyDetailRoute() {
  const navigate = useNavigate();
  const context = useOutletContext<AppLayoutContext>();

  return (
    <ReadingPane
      selection={{ kind: "empty" }}
      activeWorkers={context.activeWorkers}
      onWorkerClick={(workerId) => navigate(`/workers/${workerId}`)}
      onNavigate={context.navigateToTarget}
      onStartThread={(ideaSlug, initialTitle) => context.openNewThread(ideaSlug, initialTitle)}
      onClose={() => {}}
    />
  );
}
