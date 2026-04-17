import { useState, useMemo, useEffect, useCallback } from "react";
import { useStudies } from "./hooks/useStudies";
import { useActiveWorkers } from "./hooks/useActiveWorkers";
import { useIdeas } from "./hooks/useIdeas";
import { useProposals } from "./hooks/useProposals";
import { useMessages } from "./hooks/useMessages";
import { useWorkers } from "./hooks/useWorkers";
import { useSystemState } from "./hooks/useSystemState";
import { useActivity } from "./hooks/useActivity";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { ReadingPane } from "./components/ReadingPane";
import { ActivityDrawer } from "./components/ActivityDrawer";
import { WorkerScreen } from "./components/WorkerScreen";
import { NewIdeaModal } from "./components/NewIdeaModal";
import { SettingsModal } from "./components/SettingsModal";
import type { NavigationTarget } from "./types";
import "./App.css";

export default function App() {
  const { ideas, studyCounts } = useIdeas();
  const { workers, spawnWorker, removeWorker, killWorkerTask } = useWorkers();
  const { proposals } = useProposals();
  const { messages } = useMessages();
  const { paused, sessionCost, pause, resume } = useSystemState();
  const { activity } = useActivity();
  const { studiesCache, fetchStudies } = useStudies(studyCounts);
  const activeWorkers = useActiveWorkers(workers);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedStudy, setSelectedStudy] = useState<number | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<number | null>(null);
  const [scrollToAnnotationId, setScrollToAnnotationId] = useState<number | null>(null);
  const [workerScreenOpen, setWorkerScreenOpen] = useState(false);
  const [initialWorkerId, setInitialWorkerId] = useState<number | null>(null);
  const [showNewIdea, setShowNewIdea] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");

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
      const active = workers.filter((w) => w.status === "researching").length;
      const idle = workers.length - active;
      document.title = `Seminar (${active} active, ${idle} idle)`;
    }
  }, [workers, paused]);

  const selectedIdea = useMemo(
    () => ideas.find((i) => i.slug === selectedSlug) ?? null,
    [ideas, selectedSlug],
  );

  const navigateTo = useCallback((target: NavigationTarget) => {
    switch (target.type) {
      case "idea":
        setSelectedSlug(target.slug);
        setSelectedStudy(null);
        setSelectedProposal(null);
        setSelectedMessage(null);
        setScrollToAnnotationId(null);
        break;
      case "study":
        setSelectedSlug(target.slug);
        setSelectedStudy(target.study_number);
        setSelectedProposal(null);
        setSelectedMessage(null);
        setScrollToAnnotationId(null);
        break;
      case "proposal":
        setSelectedProposal(target.slug);
        setSelectedSlug(null);
        setSelectedStudy(null);
        setSelectedMessage(null);
        setScrollToAnnotationId(null);
        break;
      case "message":
        setSelectedMessage(target.id);
        setSelectedProposal(null);
        setSelectedSlug(null);
        setSelectedStudy(null);
        setScrollToAnnotationId(null);
        break;
      case "annotation":
        setSelectedSlug(target.slug);
        setSelectedStudy(target.study_number);
        setSelectedProposal(null);
        setScrollToAnnotationId(target.annotation_id);
        break;
    }
    setWorkerScreenOpen(false);
  }, []);

  const handleTogglePause = () => {
    if (paused) void resume();
    else void pause();
  };

  const handleSpawnWorker = (type: "initial_exploration" | "follow_up_research" | "connective_research") => {
    void spawnWorker(type);
  };

  const handleDismissWorker = (workerId: number) => {
    void removeWorker(workerId);
  };

  const handleKillTask = (workerId: number) => {
    void killWorkerTask(workerId);
  };

  return (
    <div className="app">
      <TopBar
        workers={workers}
        paused={paused}
        sessionCost={sessionCost}
        dark={dark}
        onTogglePause={handleTogglePause}
        onToggleTheme={() => setDark((d) => !d)}
        onWorkersClick={() => { setWorkerScreenOpen((prev) => !prev); setInitialWorkerId(null); }}
        onSpawnWorker={handleSpawnWorker}
        onNewIdea={() => setShowNewIdea(true)}
        onOpenSettings={() => setShowSettings(true)}
        onNavigate={navigateTo}
      />

      <div className="app-body">
        {sidebarOpen ? (
          <Sidebar
            ideas={ideas}
            proposals={proposals}
            messages={messages}
            activeWorkers={activeWorkers}
            selectedSlug={selectedSlug}
            selectedStudy={selectedStudy}
            selectedProposal={selectedProposal}
            selectedMessage={selectedMessage}
            studyCounts={studyCounts}
            studiesCache={studiesCache}
            fetchStudies={fetchStudies}
            onNavigate={navigateTo}
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
        {workerScreenOpen ? (
          <WorkerScreen
            workers={workers}
            ideas={ideas}
            initialWorkerId={initialWorkerId}
            onClose={() => { setWorkerScreenOpen(false); setInitialWorkerId(null); }}
            onNavigate={navigateTo}
            onDismissWorker={handleDismissWorker}
            onKillTask={handleKillTask}
          />
        ) : (
          <ReadingPane
            idea={selectedIdea}
            selectedProposal={selectedProposal ? proposals.find((p) => p.slug === selectedProposal) ?? null : null}
            selectedMessage={selectedMessage ? messages.find((m) => m.id === selectedMessage) ?? null : null}
            activeWorkers={activeWorkers}
            onWorkerClick={(workerId) => { setInitialWorkerId(workerId); setWorkerScreenOpen(true); }}
            selectedStudy={selectedStudy}
            scrollToAnnotationId={scrollToAnnotationId}
            onScrollToAnnotationHandled={() => setScrollToAnnotationId(null)}
            studiesCache={studiesCache}
            fetchStudies={fetchStudies}
            onNavigate={navigateTo}
            onClose={() => {
              setSelectedSlug(null);
              setSelectedStudy(null);
              setSelectedProposal(null);
              setSelectedMessage(null);
              setScrollToAnnotationId(null);
            }}
          />
        )}
      </div>

      <ActivityDrawer activity={activity} workers={workers} onWorkerClick={(workerId) => { setInitialWorkerId(workerId); setWorkerScreenOpen(true); }} onNavigate={navigateTo} />

      {showNewIdea && (
        <NewIdeaModal onClose={() => setShowNewIdea(false)} />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
