import { useMemo } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ReadingPane } from "../components/ReadingPane";
import { useThreads } from "../hooks/useThreads";
import { useWorkers } from "../hooks/useWorkers";
import { useActiveWorkers } from "../hooks/useActiveWorkers";
import type { AppLayoutContext } from "./AppLayout";

export function ThreadDetailRoute() {
  const navigate = useNavigate();
  const { threadId } = useParams();
  const { threads } = useThreads();
  const { workers } = useWorkers();
  const activeWorkers = useActiveWorkers(workers);
  const context = useOutletContext<AppLayoutContext>();
  const selectedThread = useMemo(
    () => threads.find((entry) => entry.id === Number(threadId)) ?? null,
    [threads, threadId],
  );

  return (
    <ReadingPane
      selection={selectedThread == null ? { kind: "empty" } : { kind: "thread", thread: selectedThread }}
      activeWorkers={activeWorkers}
      onWorkerClick={(workerId) => navigate(`/workers/${workerId}`)}
      onNavigate={context.navigateToTarget}
      onStartThread={(ideaSlug, initialTitle) => context.openNewThread(ideaSlug, initialTitle)}
      onClose={() => navigate("/")}
    />
  );
}
