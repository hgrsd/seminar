import { useMemo } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ReadingPane } from "../components/ReadingPane";
import type { AppLayoutContext } from "./AppLayout";

export function ProposalDetailRoute() {
  const navigate = useNavigate();
  const { slug } = useParams();
  const context = useOutletContext<AppLayoutContext>();
  const proposal = useMemo(
    () => context.proposals.find((entry) => entry.slug === slug) ?? null,
    [context.proposals, slug],
  );

  return (
    <ReadingPane
      idea={null}
      selectedProposal={proposal}
      selectedThread={null}
      activeWorkers={context.activeWorkers}
      onWorkerClick={(workerId) => navigate(`/workers/${workerId}`)}
      selectedStudy={null}
      scrollToAnnotationId={null}
      onScrollToAnnotationHandled={() => {}}
      onNavigate={context.navigateToTarget}
      onStartThread={(ideaSlug, initialTitle) => context.openNewThread(ideaSlug, initialTitle)}
      onClose={() => navigate("/")}
    />
  );
}
