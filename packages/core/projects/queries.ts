import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const projectKeys = {
  all: (wsId: string) => ["projects", wsId] as const,
  list: (wsId: string) => [...projectKeys.all(wsId), "list"] as const,
  detail: (wsId: string, id: string) =>
    [...projectKeys.all(wsId), "detail", id] as const,
  workspace: (wsId: string, id: string) =>
    [...projectKeys.detail(wsId, id), "workspace"] as const,
  activity: (wsId: string, id: string) =>
    [...projectKeys.detail(wsId, id), "activity"] as const,
  device: (wsId: string, id: string, deviceId: string) =>
    [...projectKeys.workspace(wsId, id), "device", deviceId] as const,
  deviceGitStatus: (wsId: string, id: string, deviceId: string) =>
    [...projectKeys.device(wsId, id, deviceId), "git", "status"] as const,
  deviceGitDiff: (wsId: string, id: string, deviceId: string) =>
    [...projectKeys.device(wsId, id, deviceId), "git", "diff"] as const,
  deviceGitLog: (wsId: string, id: string, deviceId: string) =>
    [...projectKeys.device(wsId, id, deviceId), "git", "log"] as const,
  deviceGitSnapshots: (wsId: string, id: string, deviceId: string) =>
    [...projectKeys.device(wsId, id, deviceId), "git", "snapshots"] as const,
  deviceFileTree: (wsId: string, id: string, deviceId: string, path = "") =>
    [...projectKeys.device(wsId, id, deviceId), "files", "tree", path] as const,
  deviceFileRead: (wsId: string, id: string, deviceId: string, path: string) =>
    [...projectKeys.device(wsId, id, deviceId), "files", "read", path] as const,
  deviceScripts: (wsId: string, id: string, deviceId: string) =>
    [...projectKeys.device(wsId, id, deviceId), "scripts"] as const,
  deviceTerminals: (wsId: string, id: string, deviceId: string) =>
    [...projectKeys.device(wsId, id, deviceId), "terminal"] as const,
};

export function projectListOptions(wsId: string) {
  return queryOptions({
    queryKey: projectKeys.list(wsId),
    queryFn: () => api.listProjects(),
    select: (data) => data.projects,
  });
}

export function projectDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: projectKeys.detail(wsId, id),
    queryFn: () => api.getProject(id),
  });
}

export function projectWorkspaceOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: projectKeys.workspace(wsId, id),
    queryFn: () => api.getProjectWorkspace(id),
  });
}

export function projectActivityOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: projectKeys.activity(wsId, id),
    queryFn: () => api.listProjectActivity(id),
  });
}

export function projectDeviceGitStatusOptions(wsId: string, id: string, deviceId: string) {
  return queryOptions({
    queryKey: projectKeys.deviceGitStatus(wsId, id, deviceId),
    queryFn: () => api.getProjectDeviceGitStatus(id, deviceId),
  });
}

export function projectDeviceGitDiffOptions(wsId: string, id: string, deviceId: string) {
  return queryOptions({
    queryKey: projectKeys.deviceGitDiff(wsId, id, deviceId),
    queryFn: () => api.getProjectDeviceGitDiff(id, deviceId),
  });
}

export function projectDeviceGitLogOptions(wsId: string, id: string, deviceId: string) {
  return queryOptions({
    queryKey: projectKeys.deviceGitLog(wsId, id, deviceId),
    queryFn: () => api.getProjectDeviceGitLog(id, deviceId),
  });
}

export function projectDeviceGitSnapshotsOptions(wsId: string, id: string, deviceId: string) {
  return queryOptions({
    queryKey: projectKeys.deviceGitSnapshots(wsId, id, deviceId),
    queryFn: () => api.getProjectDeviceSafetySnapshots(id, deviceId),
  });
}

export function projectDeviceFileTreeOptions(wsId: string, id: string, deviceId: string, path = "") {
  return queryOptions({
    queryKey: projectKeys.deviceFileTree(wsId, id, deviceId, path),
    queryFn: () => api.getProjectDeviceFileTree(id, deviceId, path),
  });
}

export function projectDeviceFileReadOptions(wsId: string, id: string, deviceId: string, path: string) {
  return queryOptions({
    queryKey: projectKeys.deviceFileRead(wsId, id, deviceId, path),
    queryFn: () => api.readProjectDeviceFile(id, deviceId, path),
  });
}

export function projectDeviceScriptsOptions(wsId: string, id: string, deviceId: string) {
  return queryOptions({
    queryKey: projectKeys.deviceScripts(wsId, id, deviceId),
    queryFn: () => api.listProjectDeviceScripts(id, deviceId),
  });
}

export function projectDeviceTerminalsOptions(wsId: string, id: string, deviceId: string) {
  return queryOptions({
    queryKey: projectKeys.deviceTerminals(wsId, id, deviceId),
    queryFn: () => api.listProjectDeviceTerminals(id, deviceId),
  });
}
