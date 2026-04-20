import { useMemo } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ReadingPane } from "../components/ReadingPane";
import { useProposals } from "../hooks/useProposals";
import { useWorkers } from "../hooks/useWorkers";
import { useActiveWorkers } from "../hooks/useActiveWorkers";
import type { AppLayoutContext } from "./AppLayout";

export function ProposalDetailRoute() {
  const navigate = useNavigate();
  const { slug } = useParams();
  const { proposals } = useProposals();
  const { workers } = useWorkers();
  const activeWorkers = useActiveWorkers(workers);
  const context = useOutletContext<AppLayoutContext>();
  const proposal = useMemo(
    () => proposals.find((entry) => entry.slug === slug) ?? null,
    [proposals, slug],
  );

  return (
    <ReadingPane
      selection={proposal == null ? { kind: "empty" } : { kind: "proposal", proposal }}
      activeWorkers={activeWorkers}
      onWorkerClick={(workerId) => navigate(`/workers/${workerId}`)}
      onNavigate={context.navigateToTarget}
      onStartThread={(ideaSlug, initialTitle) => context.openNewThread(ideaSlug, initialTitle)}
      onClose={() => navigate("/")}
    />
  );
}
