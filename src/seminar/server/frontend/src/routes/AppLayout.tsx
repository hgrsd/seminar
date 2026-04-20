import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, matchPath, useLocation, useNavigate } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { Sidebar } from "../components/Sidebar";
import { ActivityDrawer } from "../components/ActivityDrawer";
import { NewIdeaModal } from "../components/NewIdeaModal";
import { NewThreadModal } from "../components/NewThreadModal";
import { SettingsModal } from "../components/SettingsModal";
import { useIdeas } from "../hooks/useIdeas";
import { useProposals } from "../hooks/useProposals";
import { useThreads } from "../hooks/useThreads";
import { useWorkers } from "../hooks/useWorkers";
import { useSystemState } from "../hooks/useSystemState";
import { useActivity } from "../hooks/useActivity";
import { useActiveWorkers } from "../hooks/useActiveWorkers";
import { useStudies } from "../hooks/useStudies";
import type { Idea, NavigationTarget, Proposal, StudyFile, ThreadSummary, Worker } from "../types";
import "../App.css";

export interface AppLayoutContext {
  ideas: Idea[];
  proposals: Proposal[];
  threads: ThreadSummary[];
  workers: Worker[];
  activeWorkers: Map<string, Worker>;
  studiesCache: Record<string, StudyFile[]>;
  fetchStudies: (slug: string) => void;
  openNewThread: (ideaSlug?: string | null, initialTitle?: string) => void;
  navigateToTarget: (target: NavigationTarget) => void;
}

function targetPath(target: NavigationTarget): string {
  switch (target.type) {
    case "idea":
      return `/ideas/${target.slug}`;
    case "study":
      return `/ideas/${target.slug}/studies/${target.study_number}`;
    case "proposal":
      return `/proposals/${target.slug}`;
    case "thread":
      return `/threads/${target.id}`;
    case "annotation":
      return `/ideas/${target.slug}/studies/${target.study_number}?annotation=${target.annotation_id}`;
  }
}

function getSelection(pathname: string) {
  const studyMatch = matchPath("/ideas/:slug/studies/:studyNumber", pathname);
  if (studyMatch) {
    return {
      selectedSlug: studyMatch.params.slug ?? null,
      selectedStudy: Number(studyMatch.params.studyNumber),
      selectedProposal: null,
      selectedThread: null,
    };
  }

  const ideaMatch = matchPath("/ideas/:slug", pathname);
  if (ideaMatch) {
    return {
      selectedSlug: ideaMatch.params.slug ?? null,
      selectedStudy: null,
      selectedProposal: null,
      selectedThread: null,
    };
  }

  const proposalMatch = matchPath("/proposals/:slug", pathname);
  if (proposalMatch) {
    return {
      selectedSlug: null,
      selectedStudy: null,
      selectedProposal: proposalMatch.params.slug ?? null,
      selectedThread: null,
    };
  }

  const threadMatch = matchPath("/threads/:threadId", pathname);
  if (threadMatch) {
    return {
      selectedSlug: null,
      selectedStudy: null,
      selectedProposal: null,
      selectedThread: Number(threadMatch.params.threadId),
    };
  }

  return {
    selectedSlug: null,
    selectedStudy: null,
    selectedProposal: null,
    selectedThread: null,
  };
}

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { ideas, studyCounts } = useIdeas();
  const { proposals } = useProposals();
  const { threads } = useThreads();
  const { workers, spawnWorker } = useWorkers();
  const { paused, sessionCost, pause, resume } = useSystemState();
  const { activity } = useActivity();
  const { studiesCache, fetchStudies } = useStudies(studyCounts);
  const activeWorkers = useActiveWorkers(workers);
  const [showNewIdea, setShowNewIdea] = useState(false);
  const [showNewThread, setShowNewThread] = useState(false);
  const [newThreadIdeaSlug, setNewThreadIdeaSlug] = useState<string | null>(null);
  const [newThreadInitialTitle, setNewThreadInitialTitle] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");
  const selection = useMemo(() => getSelection(location.pathname), [location.pathname]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    if (paused) {
      document.title = "Seminar (paused)";
    } else if (workers.length === 0) {
      document.title = "Seminar";
    } else {
      const active = workers.filter((worker) => worker.status === "researching").length;
      const idle = workers.length - active;
      document.title = `Seminar (${active} active, ${idle} idle)`;
    }
  }, [workers, paused]);

  const navigateToTarget = useCallback((target: NavigationTarget) => {
    navigate(targetPath(target));
  }, [navigate]);

  const handleTogglePause = useCallback(() => {
    if (paused) void resume();
    else void pause();
  }, [pause, paused, resume]);

  const handleSpawnWorker = useCallback((type: "initial_exploration" | "follow_up_research" | "connective_research") => {
    void spawnWorker(type);
  }, [spawnWorker]);

  const openNewThread = useCallback((ideaSlug?: string | null, initialTitle = "") => {
    setNewThreadIdeaSlug(ideaSlug ?? null);
    setNewThreadInitialTitle(initialTitle);
    setShowNewThread(true);
  }, []);

  const context = useMemo<AppLayoutContext>(
    () => ({
      ideas,
      proposals,
      threads,
      workers,
      activeWorkers,
      studiesCache,
      fetchStudies,
      openNewThread,
      navigateToTarget,
    }),
    [activeWorkers, fetchStudies, ideas, navigateToTarget, openNewThread, proposals, studiesCache, threads, workers],
  );

  return (
    <div className="app">
      <TopBar
        workers={workers}
        paused={paused}
        sessionCost={sessionCost}
        dark={dark}
        onTogglePause={handleTogglePause}
        onToggleTheme={() => setDark((current) => !current)}
        onWorkersClick={() => navigate("/workers")}
        onSpawnWorker={handleSpawnWorker}
        onNewIdea={() => setShowNewIdea(true)}
        onNewThread={() => openNewThread()}
        onOpenSettings={() => setShowSettings(true)}
        onNavigate={navigateToTarget}
      />

      <div className="app-body">
        {sidebarOpen ? (
          <Sidebar
            ideas={ideas}
            proposals={proposals}
            threads={threads}
            activeWorkers={activeWorkers}
            selectedSlug={selection.selectedSlug}
            selectedStudy={selection.selectedStudy}
            selectedProposal={selection.selectedProposal}
            selectedThread={selection.selectedThread}
            studyCounts={studyCounts}
            studiesCache={studiesCache}
            fetchStudies={fetchStudies}
            onNavigate={navigateToTarget}
            onCollapse={() => setSidebarOpen(false)}
          />
        ) : (
          <button
            className="sidebar-collapsed"
            onClick={() => setSidebarOpen(true)}
            title="Show sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="2" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
              <line x1="6" y1="2" x2="6" y2="14" stroke="currentColor" strokeWidth="1.5" />
              <polyline points="9.5,6.5 11.5,8 9.5,9.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        <Outlet context={context} />
      </div>

      <ActivityDrawer
        activity={activity}
        workers={workers}
        onWorkerClick={(workerId) => navigate(`/workers/${workerId}`)}
        onNavigate={navigateToTarget}
      />

      {showNewIdea && <NewIdeaModal onClose={() => setShowNewIdea(false)} />}
      {showNewThread && (
        <NewThreadModal
          ideaSlug={newThreadIdeaSlug}
          initialTitle={newThreadInitialTitle}
          onClose={() => {
            setShowNewThread(false);
            setNewThreadIdeaSlug(null);
            setNewThreadInitialTitle("");
          }}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
