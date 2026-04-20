import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { WorkerScreen } from "../components/WorkerScreen";
import { useIdeas } from "../hooks/useIdeas";
import { useThreads } from "../hooks/useThreads";
import { useWorkers } from "../hooks/useWorkers";
import type { AppLayoutContext } from "./AppLayout";

function WorkerScreenRoute({ initialWorkerId }: { initialWorkerId: number | null }) {
  const navigate = useNavigate();
  const { ideas } = useIdeas();
  const { threads } = useThreads();
  const { workers, removeWorker, killWorkerTask } = useWorkers();
  const context = useOutletContext<AppLayoutContext>();

  return (
    <WorkerScreen
      workers={workers}
      ideas={ideas}
      threads={threads}
      initialWorkerId={initialWorkerId}
      onClose={() => navigate("/")}
      onOpenWorker={(workerId) => navigate(`/workers/${workerId}`)}
      onBackToWorkers={() => navigate("/workers")}
      onNavigate={context.navigateToTarget}
      onDismissWorker={(workerId) => {
        void removeWorker(workerId);
        if (initialWorkerId === workerId) navigate("/workers");
      }}
      onKillTask={(workerId) => {
        void killWorkerTask(workerId);
      }}
    />
  );
}

export function WorkersRoute() {
  return <WorkerScreenRoute initialWorkerId={null} />;
}

export function WorkerDetailRoute() {
  const { workerId } = useParams();
  return <WorkerScreenRoute initialWorkerId={workerId ? Number(workerId) : null} />;
}
