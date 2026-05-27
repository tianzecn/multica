"use client";

import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "../hooks";
import { agentListOptions } from "../workspace/queries";

/**
 * Three-state availability for "does the current user have any agent
 * they can chat with in this workspace?".
 *
 * Why three states (not a boolean): the answer to "is there an agent?"
 * lives on the server. Until the agent-list query resolves, the answer
 * is genuinely *unknown*. Callers must distinguish "loading" from
 * "confirmed empty" — collapsing them to a boolean causes UIs to flash
 * disabled/empty states for the first few hundred ms after mount, even
 * when the workspace actually has agents.
 *
 *   "loading"   — agent list still in flight (be neutral in UI)
 *   "none"      — the agent query resolved, user has zero chat-visible agents
 *   "available" — at least one visible agent is not archived
 */
export type WorkspaceAgentAvailability = "loading" | "none" | "available";

/**
 * Chat reachability is intentionally not the same as issue assignment.
 * `GET /api/agents` already filters out private agents the caller cannot
 * access; this hook only removes archived rows so chat can offer every
 * visible agent instead of inheriting assignment-specific restrictions.
 */
export function useWorkspaceAgentAvailability(): WorkspaceAgentAvailability {
  const wsId = useWorkspaceId();
  const { data: agents, isFetched: agentsFetched } = useQuery(
    agentListOptions(wsId),
  );

  if (!agentsFetched) return "loading";

  const hasVisibleAgent = (agents ?? []).some((a) => !a.archived_at);

  return hasVisibleAgent ? "available" : "none";
}
