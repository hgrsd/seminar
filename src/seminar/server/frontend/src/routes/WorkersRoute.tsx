import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { WorkerScreen } from "../components/WorkerScreen";
import { useWorkers } from "../hooks/useWorkers";
import type { AppLayoutContext } from "./AppLayout";

function WorkerScreenRoute({ initialWorkerId }: { initialWorkerId: number | null }) {
  const navigate = useNavigate();
  const context = useOutletContext<AppLayoutContext>();
  const { removeWorker, killWorkerTask } = useWorkers();

  return (
    <WorkerScreen
      workers={context.workers}
      ideas={context.ideas}
      threads={context.threads}
      initialWorkerId={initialWorkerId}
      onClose={() => navigate("/")}
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
