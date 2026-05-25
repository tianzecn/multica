"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createWorkspaceAwareStorage, registerForWorkspaceRehydration } from "../../platform/workspace-storage";
import { defaultStorage } from "../../platform/storage";

interface ProjectSidebarTreeState {
  expandedProjectIds: string[];
  archivedChannelsOpen: boolean;
  unassignedChannelsOpen: boolean;
  toggleProject: (projectId: string) => void;
  setProjectOpen: (projectId: string, open: boolean) => void;
  setArchivedChannelsOpen: (open: boolean) => void;
  setUnassignedChannelsOpen: (open: boolean) => void;
}

export const useProjectSidebarTreeStore = create<ProjectSidebarTreeState>()(
  persist(
    (set) => ({
      expandedProjectIds: [],
      archivedChannelsOpen: false,
      unassignedChannelsOpen: true,
      toggleProject: (projectId) =>
        set((state) => ({
          expandedProjectIds: state.expandedProjectIds.includes(projectId)
            ? state.expandedProjectIds.filter((id) => id !== projectId)
            : [...state.expandedProjectIds, projectId],
        })),
      setProjectOpen: (projectId, open) =>
        set((state) => {
          const hasProject = state.expandedProjectIds.includes(projectId);
          if (open && !hasProject) return { expandedProjectIds: [...state.expandedProjectIds, projectId] };
          if (!open && hasProject) return { expandedProjectIds: state.expandedProjectIds.filter((id) => id !== projectId) };
          return state;
        }),
      setArchivedChannelsOpen: (open) => set({ archivedChannelsOpen: open }),
      setUnassignedChannelsOpen: (open) => set({ unassignedChannelsOpen: open }),
    }),
    {
      name: "multica_project_sidebar_tree",
      storage: createJSONStorage(() => createWorkspaceAwareStorage(defaultStorage)),
      partialize: (state) => ({
        expandedProjectIds: state.expandedProjectIds,
        archivedChannelsOpen: state.archivedChannelsOpen,
        unassignedChannelsOpen: state.unassignedChannelsOpen,
      }),
    },
  ),
);

registerForWorkspaceRehydration(() => useProjectSidebarTreeStore.persist.rehydrate());
