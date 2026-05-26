"use client";

import { use } from "react";
import { ConversationsPage } from "@multica/views/conversations";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <ConversationsPage sessionId={id} />;
}
