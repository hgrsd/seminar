import { useMemo } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ReadingPane } from "../components/ReadingPane";
import type { AppLayoutContext } from "./AppLayout";

export function ThreadDetailRoute() {
  const navigate = useNavigate();
  const { threadId } = useParams();
  const context = useOutletContext<AppLayoutContext>();
  const selectedThread = useMemo(
    () => context.threads.find((entry) => entry.id === Number(threadId)) ?? null,
    [context.threads, threadId],
  );

  return (
    <ReadingPane
      selection={selectedThread == null ? { kind: "empty" } : { kind: "thread", thread: selectedThread }}
      activeWorkers={context.activeWorkers}
      onWorkerClick={(workerId) => navigate(`/workers/${workerId}`)}
      onNavigate={context.navigateToTarget}
      onStartThread={(ideaSlug, initialTitle) => context.openNewThread(ideaSlug, initialTitle)}
      onClose={() => navigate("/")}
    />
  );
}
