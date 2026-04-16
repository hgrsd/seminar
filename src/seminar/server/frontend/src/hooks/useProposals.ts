import { useSeminarActions, useSeminarState } from "./useSeminarStore";

export function useProposals() {
  const { proposals } = useSeminarState();
  const { approveProposal, rejectProposal, deleteProposal } = useSeminarActions();

  return {
    proposals,
    approveProposal,
    rejectProposal,
    deleteProposal,
  };
}
