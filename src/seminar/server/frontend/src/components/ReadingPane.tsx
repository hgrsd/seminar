import type { Idea, NavigationTarget, Proposal, ThreadSummary, Worker } from "../types";
import { EmptyReadingPane } from "./reading-pane/EmptyReadingPane";
import { IdeaPane } from "./reading-pane/IdeaPane";
import { ProposalPane } from "./reading-pane/ProposalPane";
import { StudyPane } from "./reading-pane/StudyPane";
import { ThreadPane } from "./reading-pane/ThreadPane";

interface Props {
  idea: Idea | null;
  selectedProposal: Proposal | null;
  selectedThread: ThreadSummary | null;
  activeWorkers: Map<string, Worker>;
  onWorkerClick: (workerId: number) => void;
  selectedStudy: number | null;
  scrollToAnnotationId: number | null;
  onScrollToAnnotationHandled: () => void;
  onNavigate: (target: NavigationTarget) => void;
  onStartThread: (ideaSlug: string | null, initialTitle: string) => void;
  onClose: () => void;
}

export function ReadingPane({
  idea,
  selectedProposal,
  selectedThread,
  activeWorkers,
  onWorkerClick,
  selectedStudy,
  scrollToAnnotationId,
  onScrollToAnnotationHandled,
  onNavigate,
  onStartThread,
  onClose,
}: Props) {
  if (selectedThread) {
    return (
      <ThreadPane
        thread={selectedThread}
        activeWorkers={activeWorkers}
        onWorkerClick={onWorkerClick}
        onNavigate={onNavigate}
        onClose={onClose}
      />
    );
  }

  if (selectedProposal) {
    return (
      <ProposalPane
        proposal={selectedProposal}
        onNavigate={onNavigate}
        onClose={onClose}
      />
    );
  }

  if (!idea) {
    return <EmptyReadingPane />;
  }

  if (selectedStudy) {
    return (
      <StudyPane
        idea={idea}
        selectedStudy={selectedStudy}
        scrollToAnnotationId={scrollToAnnotationId}
        onScrollToAnnotationHandled={onScrollToAnnotationHandled}
        onNavigate={onNavigate}
        onClose={onClose}
      />
    );
  }

  return (
    <IdeaPane
      idea={idea}
      activeWorkers={activeWorkers}
      onWorkerClick={onWorkerClick}
      onNavigate={onNavigate}
      onStartThread={onStartThread}
      onClose={onClose}
    />
  );
}
