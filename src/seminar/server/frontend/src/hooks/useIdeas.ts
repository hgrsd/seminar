import { useSeminarActions, useSeminarState } from "./useSeminarStore";

export function useIdeas() {
  const { ideas, studyCounts } = useSeminarState();
  const {
    createIdea,
    markIdeaDone,
    reopenIdea,
    resetIdea,
    deleteIdea,
    addDirectorNote,
  } = useSeminarActions();

  return {
    ideas,
    studyCounts,
    createIdea,
    markIdeaDone,
    reopenIdea,
    resetIdea,
    deleteIdea,
    addDirectorNote,
  };
}
