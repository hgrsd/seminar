import type { Idea, NavigationTarget, Proposal, ThreadSummary, Worker } from "../types";
import { EmptyReadingPane } from "./reading-pane/EmptyReadingPane";
import { IdeaPane } from "./reading-pane/IdeaPane";
import { ProposalPane } from "./reading-pane/ProposalPane";
import { StudyPane } from "./reading-pane/StudyPane";
import { ThreadPane } from "./reading-pane/ThreadPane";

export type ReadingPaneSelection =
  | { kind: "empty" }
  | { kind: "idea"; idea: Idea }
  | { kind: "study"; idea: Idea; selectedStudy: number; scrollToAnnotationId: number | null; onScrollToAnnotationHandled: () => void }
  | { kind: "proposal"; proposal: Proposal }
  | { kind: "thread"; thread: ThreadSummary };

interface Props {
  selection: ReadingPaneSelection;
  activeWorkers: Map<string, Worker>;
  onWorkerClick: (workerId: number) => void;
  onNavigate: (target: NavigationTarget) => void;
  onStartThread: (ideaSlug: string | null, initialTitle: string) => void;
  onClose: () => void;
}

export function ReadingPane({
  selection,
  activeWorkers,
  onWorkerClick,
  onNavigate,
  onStartThread,
  onClose,
}: Props) {
  switch (selection.kind) {
    case "thread":
      return (
        <ThreadPane
          thread={selection.thread}
          activeWorkers={activeWorkers}
          onWorkerClick={onWorkerClick}
          onNavigate={onNavigate}
          onClose={onClose}
        />
      );

    case "proposal":
      return (
        <ProposalPane
          proposal={selection.proposal}
          onNavigate={onNavigate}
          onClose={onClose}
        />
      );

    case "empty":
      return <EmptyReadingPane />;

    case "study":
      return (
        <StudyPane
          idea={selection.idea}
          selectedStudy={selection.selectedStudy}
          scrollToAnnotationId={selection.scrollToAnnotationId}
          onScrollToAnnotationHandled={selection.onScrollToAnnotationHandled}
          onNavigate={onNavigate}
          onClose={onClose}
        />
      );

    case "idea":
      return (
        <IdeaPane
          idea={selection.idea}
          activeWorkers={activeWorkers}
          onWorkerClick={onWorkerClick}
          onNavigate={onNavigate}
          onStartThread={onStartThread}
          onClose={onClose}
        />
      );
  }
}
