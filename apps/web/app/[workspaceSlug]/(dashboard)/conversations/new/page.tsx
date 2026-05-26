"use client";

import { use } from "react";
import { ConversationsPage } from "@multica/views/conversations";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = use(searchParams);
  return <ConversationsPage draft initialProjectId={project ?? null} />;
}
