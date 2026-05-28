import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { projectKeys } from "./queries";
import { useWorkspaceId } from "../hooks";
import type {
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
  ListProjectsResponse,
  ProjectWorkspace,
  ProjectFileWriteRequest,
  ProjectGitOperation,
  ProjectGitOperationRequest,
  UpdateProjectWorkspaceConfigRequest,
  UpsertProjectDeviceBindingRequest,
} from "../types";

export function useCreateProject() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: CreateProjectRequest) => api.createProject(data),
    onSuccess: (newProject) => {
      qc.setQueryData<ListProjectsResponse>(projectKeys.list(wsId), (old) =>
        old && !old.projects.some((p) => p.id === newProject.id)
          ? { ...old, projects: [...old.projects, newProject], total: old.total + 1 }
          : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: projectKeys.list(wsId) });
    },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateProjectRequest) =>
      api.updateProject(id, data),
    onMutate: ({ id, ...data }) => {
      qc.cancelQueries({ queryKey: projectKeys.list(wsId) });
      const prevList = qc.getQueryData<ListProjectsResponse>(projectKeys.list(wsId));
      const prevDetail = qc.getQueryData<Project>(projectKeys.detail(wsId, id));
      qc.setQueryData<ListProjectsResponse>(projectKeys.list(wsId), (old) =>
        old ? { ...old, projects: old.projects.map((p) => (p.id === id ? { ...p, ...data } : p)) } : old,
      );
      qc.setQueryData<Project>(projectKeys.detail(wsId, id), (old) =>
        old ? { ...old, ...data } : old,
      );
      return { prevList, prevDetail, id };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevList) qc.setQueryData(projectKeys.list(wsId), ctx.prevList);
      if (ctx?.prevDetail) qc.setQueryData(projectKeys.detail(wsId, ctx.id), ctx.prevDetail);
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(wsId, vars.id) });
      qc.invalidateQueries({ queryKey: projectKeys.list(wsId) });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: projectKeys.list(wsId) });
      const prevList = qc.getQueryData<ListProjectsResponse>(projectKeys.list(wsId));
      qc.setQueryData<ListProjectsResponse>(projectKeys.list(wsId), (old) =>
        old ? { ...old, projects: old.projects.filter((p) => p.id !== id), total: old.total - 1 } : old,
      );
      qc.removeQueries({ queryKey: projectKeys.detail(wsId, id) });
      return { prevList };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevList) qc.setQueryData(projectKeys.list(wsId), ctx.prevList);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: projectKeys.list(wsId) });
    },
  });
}

export function useUpdateProjectWorkspaceConfig(projectId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: UpdateProjectWorkspaceConfigRequest) =>
      api.updateProjectWorkspaceConfig(projectId, data),
    onSuccess: (config) => {
      qc.setQueryData<ProjectWorkspace>(projectKeys.workspace(wsId, projectId), (old) =>
        old ? { ...old, config } : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: projectKeys.workspace(wsId, projectId) });
    },
  });
}

export function useUpsertProjectDeviceBinding(projectId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ deviceId, ...data }: { deviceId: string } & UpsertProjectDeviceBindingRequest) =>
      api.upsertProjectDeviceBinding(projectId, deviceId, data),
    onSuccess: (binding) => {
      qc.setQueryData<ProjectWorkspace>(projectKeys.workspace(wsId, projectId), (old) => {
        if (!old) return old;
        const exists = old.bindings.some((b) => b.device_id === binding.device_id);
        return {
          ...old,
          bindings: exists
            ? old.bindings.map((b) => (b.device_id === binding.device_id ? binding : b))
            : [...old.bindings, binding],
        };
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: projectKeys.workspace(wsId, projectId) });
    },
  });
}

export function useRunProjectDeviceGitOperation(projectId: string, deviceId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({
      operation,
      data,
    }: {
      operation: ProjectGitOperation;
      data?: ProjectGitOperationRequest;
    }) => api.runProjectDeviceGitOperation(projectId, deviceId, operation, data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: projectKeys.device(wsId, projectId, deviceId) });
      qc.invalidateQueries({ queryKey: projectKeys.workspace(wsId, projectId) });
    },
  });
}

export function useWriteProjectDeviceFile(projectId: string, deviceId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: ProjectFileWriteRequest) =>
      api.writeProjectDeviceFile(projectId, deviceId, data),
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: projectKeys.device(wsId, projectId, deviceId) });
      qc.invalidateQueries({ queryKey: projectKeys.activity(wsId, projectId) });
      qc.invalidateQueries({
        queryKey: projectKeys.deviceFileRead(wsId, projectId, deviceId, vars.path),
      });
    },
  });
}
