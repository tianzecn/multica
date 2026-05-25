import { redirect } from "next/navigation";

export default async function ProjectIssuesRoute({
  params,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  const { workspaceSlug, id } = await params;
  redirect(`/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(id)}`);
}
