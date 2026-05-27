import { redirect } from "next/navigation";

export default async function RuntimesRoute({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(`/${encodeURIComponent(workspaceSlug)}/settings?tab=runtimes`);
}
