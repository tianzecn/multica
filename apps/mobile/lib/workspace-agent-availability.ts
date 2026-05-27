/**
 * Mobile-owned three-state availability for "does the current user have any
 * chat-visible agent in this workspace?".
 *
 * Mirror of `packages/core/agents/use-workspace-agent-availability.ts` —
 * see there for the design rationale on why this is a three-state
 * `"loading" | "none" | "available"` instead of a boolean.
 *
 * The chat NoAgentBanner uses this: only `"none"` triggers the banner +
 * input-disable; `"loading"` stays neutral to avoid a fake-empty flash on
 * mount.
 */
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/data/workspace-store";
import { agentListOptions } from "@/data/queries/agents";

export type WorkspaceAgentAvailability = "loading" | "none" | "available";

export function useWorkspaceAgentAvailability(): WorkspaceAgentAvailability {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const { data: agents, isFetched: agentsFetched } = useQuery(
    agentListOptions(wsId),
  );

  if (!agentsFetched) return "loading";

  const hasVisibleAgent = (agents ?? []).some((a) => !a.archived_at);

  return hasVisibleAgent ? "available" : "none";
}
