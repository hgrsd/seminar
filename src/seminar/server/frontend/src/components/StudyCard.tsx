import type { StudyFile } from "../types";
import { relativeTime, studyModeLabel } from "../utils";

interface Props {
  study: StudyFile;
  index: number;
  onClick: () => void;
}

function extractAbstract(content: string): string {
  const stripped = content.replace(/^##\s*Abstract\s*\n+/i, "");
  const firstPara = stripped.split(/\n\n/)[0] || "";
  return firstPara.replace(/\*\*/g, "");
}

export function StudyCard({ study, index, onClick }: Props) {
  const isDirectorNote = study.mode === "director_note";
  const label = isDirectorNote
    ? "Director's Note"
    : study.study_number
      ? `Study #${study.study_number}`
      : `Study #${index}`;

  return (
    <button className={`study-card${isDirectorNote ? " study-card--director-note" : ""}`} onClick={onClick}>
      <div className="study-card-header">
        <span className="study-card-number">{label}</span>
        {!isDirectorNote && study.mode && <span className="study-card-mode">{studyModeLabel(study.mode)}</span>}
        {study.created_at && (
          <span className="study-card-time">{relativeTime(study.created_at)}</span>
        )}
      </div>
      {!isDirectorNote && <div className="study-card-title">{study.title}</div>}
      {study.content && (
        <p className="study-card-abstract">{extractAbstract(study.content)}</p>
      )}
    </button>
  );
}
