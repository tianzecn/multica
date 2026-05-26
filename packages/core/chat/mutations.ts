import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useWorkspaceId } from "../hooks";
import { chatKeys } from "./queries";
import { createLogger } from "../logger";
import type { ChatSession } from "../types";

const logger = createLogger("chat.mut");

export function useCreateChatSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();

  return useMutation({
    mutationFn: (data: { agent_id: string; title?: string; project_id?: string | null }) => {
      logger.info("createChatSession.start", {
        agent_id: data.agent_id,
        titleLength: data.title?.length ?? 0,
        project_id: data.project_id ?? null,
      });
      return api.createChatSession(data);
    },
    onSuccess: (session) => {
      logger.info("createChatSession.success", { sessionId: session.id, agentId: session.agent_id });
      qc.setQueryData<ChatSession[]>(chatKeys.sessions(wsId), (old) => {
        if (!old) return [session];
        if (old.some((s) => s.id === session.id)) {
          return old.map((s) => (s.id === session.id ? session : s));
        }
        return [session, ...old];
      });
      qc.setQueryData<ChatSession>(chatKeys.session(wsId, session.id), session);
    },
    onError: (err) => {
      logger.error("createChatSession.error", err);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

/**
 * Clears the session's unread state server-side. Optimistically flips
 * has_unread to false in the cached list so the FAB badge drops
 * immediately. The server broadcasts chat:session_read so other devices
 * also sync.
 */
export function useMarkChatSessionRead() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();

  return useMutation({
    mutationFn: (sessionId: string) => {
      logger.info("markChatSessionRead.start", { sessionId });
      return api.markChatSessionRead(sessionId);
    },
    onMutate: async (sessionId) => {
      await qc.cancelQueries({ queryKey: chatKeys.sessions(wsId) });

      const prevSessions = qc.getQueryData<ChatSession[]>(chatKeys.sessions(wsId));

      const clear = (old?: ChatSession[]) =>
        old?.map((s) => (s.id === sessionId ? { ...s, has_unread: false } : s));
      qc.setQueryData<ChatSession[]>(chatKeys.sessions(wsId), clear);

      return { prevSessions };
    },
    onError: (err, sessionId, ctx) => {
      logger.error("markChatSessionRead.error.rollback", { sessionId, err });
      if (ctx?.prevSessions) qc.setQueryData(chatKeys.sessions(wsId), ctx.prevSessions);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

/**
 * Renames a chat session. Optimistically swaps the title in the cached
 * list so the dropdown reflects the new label immediately; rolls back on
 * error. The matching `chat:session_updated` WS event keeps other
 * tabs/devices in sync — see use-realtime-sync.ts.
 */
export function useUpdateChatSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();

  return useMutation({
    mutationFn: (data: { sessionId: string; title?: string; project_id?: string | null }) => {
      logger.info("updateChatSession.start", {
        sessionId: data.sessionId,
        titleLength: data.title?.length ?? 0,
        hasProject: Object.prototype.hasOwnProperty.call(data, "project_id"),
      });
      const payload: { title?: string; project_id?: string | null } = {};
      if (data.title !== undefined) payload.title = data.title;
      if (Object.prototype.hasOwnProperty.call(data, "project_id")) payload.project_id = data.project_id ?? null;
      return api.updateChatSession(data.sessionId, payload);
    },
    onMutate: async (vars) => {
      const { sessionId, title, project_id } = vars;
      const hasProject = Object.prototype.hasOwnProperty.call(vars, "project_id");
      await qc.cancelQueries({ queryKey: chatKeys.sessions(wsId) });
      await qc.cancelQueries({ queryKey: chatKeys.session(wsId, sessionId) });

      const prevSessions = qc.getQueryData<ChatSession[]>(chatKeys.sessions(wsId));
      const prevSession = qc.getQueryData<ChatSession>(chatKeys.session(wsId, sessionId));

      const patch = (old?: ChatSession[]) =>
        old?.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                ...(title !== undefined ? { title } : {}),
                ...(hasProject ? { project_id: project_id ?? null } : {}),
              }
            : s,
        );
      qc.setQueryData<ChatSession[]>(chatKeys.sessions(wsId), patch);
      qc.setQueryData<ChatSession>(chatKeys.session(wsId, sessionId), (old) =>
        old
          ? {
              ...old,
              ...(title !== undefined ? { title } : {}),
              ...(hasProject ? { project_id: project_id ?? null } : {}),
            }
          : old,
      );

      return { prevSessions, prevSession };
    },
    onError: (err, vars, ctx) => {
      logger.error("updateChatSession.error.rollback", { sessionId: vars.sessionId, err });
      if (ctx?.prevSessions) qc.setQueryData(chatKeys.sessions(wsId), ctx.prevSessions);
      if (ctx?.prevSession) qc.setQueryData(chatKeys.session(wsId, vars.sessionId), ctx.prevSession);
    },
    onSuccess: (session) => {
      qc.setQueryData<ChatSession[]>(chatKeys.sessions(wsId), (old) =>
        old?.map((s) => (s.id === session.id ? session : s)),
      );
      qc.setQueryData<ChatSession>(chatKeys.session(wsId, session.id), session);
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
      qc.invalidateQueries({ queryKey: chatKeys.session(wsId, vars.sessionId) });
    },
  });
}

function upsertChatSession(old: ChatSession[] | undefined, session: ChatSession) {
  if (!old) return [session];
  if (old.some((s) => s.id === session.id)) {
    return old.map((s) => (s.id === session.id ? session : s));
  }
  return [session, ...old];
}

function useSetChatSessionStatus(status: ChatSession["status"]) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();

  return useMutation({
    mutationFn: (sessionId: string) => {
      logger.info("setChatSessionStatus.start", { sessionId, status });
      return status === "archived"
        ? api.archiveChatSession(sessionId)
        : api.restoreChatSession(sessionId);
    },
    onMutate: async (sessionId) => {
      await qc.cancelQueries({ queryKey: chatKeys.sessions(wsId) });
      await qc.cancelQueries({ queryKey: chatKeys.session(wsId, sessionId) });

      const prevSessions = qc.getQueryData<ChatSession[]>(chatKeys.sessions(wsId));
      const prevSession = qc.getQueryData<ChatSession>(chatKeys.session(wsId, sessionId));

      const patch = (old?: ChatSession[]) =>
        old?.map((s) => (s.id === sessionId ? { ...s, status } : s));
      qc.setQueryData<ChatSession[]>(chatKeys.sessions(wsId), patch);
      qc.setQueryData<ChatSession>(chatKeys.session(wsId, sessionId), (old) =>
        old ? { ...old, status } : old,
      );

      return { prevSessions, prevSession };
    },
    onError: (err, sessionId, ctx) => {
      logger.error("setChatSessionStatus.error.rollback", { sessionId, status, err });
      if (ctx?.prevSessions) qc.setQueryData(chatKeys.sessions(wsId), ctx.prevSessions);
      if (ctx?.prevSession) qc.setQueryData(chatKeys.session(wsId, sessionId), ctx.prevSession);
    },
    onSuccess: (session) => {
      qc.setQueryData<ChatSession[]>(chatKeys.sessions(wsId), (old) => upsertChatSession(old, session));
      qc.setQueryData<ChatSession>(chatKeys.session(wsId, session.id), session);
    },
    onSettled: (_data, _err, sessionId) => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
      qc.invalidateQueries({ queryKey: chatKeys.session(wsId, sessionId) });
    },
  });
}

export function useArchiveChatSession() {
  return useSetChatSessionStatus("archived");
}

export function useRestoreChatSession() {
  return useSetChatSessionStatus("active");
}

/**
 * Hard-deletes a chat session. Optimistically removes the row from the
 * sessions list so the dropdown updates instantly; rolls back on error.
 * The matching `chat:session_deleted` WS event keeps other tabs/devices
 * in sync — see use-realtime-sync.ts.
 */
export function useDeleteChatSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();

  return useMutation({
    mutationFn: (sessionId: string) => {
      logger.info("deleteChatSession.start", { sessionId });
      return api.deleteChatSession(sessionId);
    },
    onMutate: async (sessionId) => {
      await qc.cancelQueries({ queryKey: chatKeys.sessions(wsId) });

      const prevSessions = qc.getQueryData<ChatSession[]>(chatKeys.sessions(wsId));

      const drop = (old?: ChatSession[]) => old?.filter((s) => s.id !== sessionId);
      qc.setQueryData<ChatSession[]>(chatKeys.sessions(wsId), drop);

      logger.debug("deleteChatSession.optimistic", { sessionId });
      return { prevSessions };
    },
    onError: (err, sessionId, ctx) => {
      logger.error("deleteChatSession.error.rollback", { sessionId, err });
      if (ctx?.prevSessions) qc.setQueryData(chatKeys.sessions(wsId), ctx.prevSessions);
    },
    onSettled: (_data, _err, sessionId) => {
      logger.debug("deleteChatSession.settled", { sessionId });
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}
