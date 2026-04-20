import { useNavigate, useOutletContext } from "react-router-dom";
import { ReadingPane } from "../components/ReadingPane";
import type { AppLayoutContext } from "./AppLayout";

export function EmptyDetailRoute() {
  const navigate = useNavigate();
  const context = useOutletContext<AppLayoutContext>();

  return (
    <ReadingPane
      idea={null}
      selectedProposal={null}
      selectedThread={null}
      activeWorkers={context.activeWorkers}
      onWorkerClick={(workerId) => navigate(`/workers/${workerId}`)}
      selectedStudy={null}
      scrollToAnnotationId={null}
      onScrollToAnnotationHandled={() => {}}
      studiesCache={context.studiesCache}
      fetchStudies={context.fetchStudies}
      onNavigate={context.navigateToTarget}
      onStartThread={(ideaSlug, initialTitle) => context.openNewThread(ideaSlug, initialTitle)}
      onClose={() => {}}
    />
  );
}
