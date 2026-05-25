"use client";

import { useQuery } from "@tanstack/react-query";
import { projectDetailOptions } from "@multica/core/projects/queries";
import { useWorkspaceId } from "@multica/core/hooks";
import { IssuesPage } from "../../issues/components";

export function ProjectIssuesPage({ projectId }: { projectId: string }) {
  const wsId = useWorkspaceId();
  const { data: project } = useQuery({
    ...projectDetailOptions(wsId, projectId),
    enabled: !!wsId && !!projectId,
  });

  return <IssuesPage projectId={projectId} projectTitle={project?.title} />;
}
