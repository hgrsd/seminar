import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Proposal } from "../types";
import { queryKeys } from "../realtime/queryKeys";
import { snapshotQueryOptions, useSeminarActions } from "./useSeminarStore";

export function useProposals() {
  const queryClient = useQueryClient();
  const proposalsQuery = useQuery({
    queryKey: queryKeys.proposals,
    queryFn: async () => {
      const snapshot = await queryClient.ensureQueryData(snapshotQueryOptions(queryClient));
      return queryClient.getQueryData<Proposal[]>(queryKeys.proposals) ?? snapshot.proposals;
    },
    staleTime: Infinity,
  });
  const { approveProposal, rejectProposal, deleteProposal } = useSeminarActions();

  return {
    proposals: proposalsQuery.data ?? [],
    approveProposal,
    rejectProposal,
    deleteProposal,
  };
}
