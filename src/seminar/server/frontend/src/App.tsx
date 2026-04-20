import { Suspense, lazy } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppLayout } from "./routes/AppLayout";

const EmptyDetailRoute = lazy(() =>
  import("./routes/EmptyDetailRoute").then((module) => ({ default: module.EmptyDetailRoute })),
);
const IdeaDetailRoute = lazy(() =>
  import("./routes/IdeaDetailRoute").then((module) => ({ default: module.IdeaDetailRoute })),
);
const ProposalDetailRoute = lazy(() =>
  import("./routes/ProposalDetailRoute").then((module) => ({ default: module.ProposalDetailRoute })),
);
const ThreadDetailRoute = lazy(() =>
  import("./routes/ThreadDetailRoute").then((module) => ({ default: module.ThreadDetailRoute })),
);
const WorkersRoute = lazy(() =>
  import("./routes/WorkersRoute").then((module) => ({ default: module.WorkersRoute })),
);
const WorkerDetailRoute = lazy(() =>
  import("./routes/WorkersRoute").then((module) => ({ default: module.WorkerDetailRoute })),
);

function RouteLoading() {
  return (
    <main className="reading-pane">
      <div className="reading-pane-empty">Loading...</div>
    </main>
  );
}

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<RouteLoading />}>{element}</Suspense>;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: withSuspense(<EmptyDetailRoute />) },
      { path: "ideas/:slug", element: withSuspense(<IdeaDetailRoute />) },
      { path: "ideas/:slug/studies/:studyNumber", element: withSuspense(<IdeaDetailRoute />) },
      { path: "proposals/:slug", element: withSuspense(<ProposalDetailRoute />) },
      { path: "threads/:threadId", element: withSuspense(<ThreadDetailRoute />) },
      { path: "workers", element: withSuspense(<WorkersRoute />) },
      { path: "workers/:workerId", element: withSuspense(<WorkerDetailRoute />) },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
