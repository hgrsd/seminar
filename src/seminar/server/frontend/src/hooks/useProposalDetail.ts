import { useQuery } from "@tanstack/react-query";
import { getProposalContent } from "../api/proposals";
import { queryKeys } from "../realtime/queryKeys";

export function useProposalDetail(slug: string | null | undefined) {
  const enabled = Boolean(slug);
  const query = useQuery({
    queryKey: slug ? queryKeys.proposalContent(slug) : ["proposal-content", "disabled"],
    queryFn: ({ signal }) => {
      if (!slug) throw new Error("Proposal detail requested without a slug");
      return getProposalContent(slug, signal);
    },
    enabled,
    staleTime: Infinity,
  });

  return {
    content: query.data?.content ?? null,
    meta: query.data?.meta ?? null,
    isLoading: query.isLoading,
  };
}
