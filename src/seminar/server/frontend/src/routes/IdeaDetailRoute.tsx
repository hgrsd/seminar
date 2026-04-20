import { useMemo } from "react";
import { useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { ReadingPane } from "../components/ReadingPane";
import type { AppLayoutContext } from "./AppLayout";

export function IdeaDetailRoute() {
  const navigate = useNavigate();
  const { slug, studyNumber } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const context = useOutletContext<AppLayoutContext>();
  const idea = useMemo(
    () => context.ideas.find((entry) => entry.slug === slug) ?? null,
    [context.ideas, slug],
  );
  const selectedStudy = studyNumber ? Number(studyNumber) : null;
  const annotationId = Number(searchParams.get("annotation") ?? "");
  const scrollToAnnotationId = Number.isFinite(annotationId) ? annotationId : null;

  return (
    <ReadingPane
      selection={
        idea == null
          ? { kind: "empty" }
          : selectedStudy != null
            ? {
                kind: "study",
                idea,
                selectedStudy,
                scrollToAnnotationId,
                onScrollToAnnotationHandled: () => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("annotation");
                  setSearchParams(next, { replace: true });
                },
              }
            : { kind: "idea", idea }
      }
      activeWorkers={context.activeWorkers}
      onWorkerClick={(workerId) => navigate(`/workers/${workerId}`)}
      onNavigate={context.navigateToTarget}
      onStartThread={(ideaSlug, initialTitle) => context.openNewThread(ideaSlug, initialTitle)}
      onClose={() => navigate("/")}
    />
  );
}
