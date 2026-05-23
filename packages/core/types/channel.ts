import type { Attachment } from "./attachment";

export type ChannelVisibility = "public" | "private";
export type ChannelProactivity = "quiet" | "standard" | "active";
export type ChannelMemberType = "member" | "agent" | "squad";
export type ChannelMemberRole = "owner" | "admin" | "member";
export type ChannelSessionStatus = "active" | "resolved" | "archived";
export type ChannelMessageType = "message" | "system" | "suggestion" | "approval";
export type ApprovalRequestStatus = "pending" | "approved" | "rejected" | "cancelled" | "executed" | "failed";
export type ChannelAgentTaskStatus = "queued" | "dispatched" | "running" | "completed" | "failed" | "cancelled";
export type ChannelDispatchMode = "single" | "parallel" | "serial" | "roundtable";
export type ChannelDispatchPlanStatus = "queued" | "running" | "completed" | "paused" | "failed" | "cancelled";
export type ChannelDispatchStepStatus = "pending" | "queued" | "running" | "completed" | "failed" | "skipped" | "cancelled";

export interface ChannelGroup {
  id: string;
  workspace_id: string;
  name: string;
  position: number;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Channel {
  id: string;
  workspace_id: string;
  group_id: string | null;
  slug: string;
  name: string;
  description: string;
  visibility: ChannelVisibility;
  proactivity: ChannelProactivity;
  mention_issue_search_enabled: boolean;
  instructions: string;
  summary: string;
  default_project_id: string | null;
  default_assignee_type: ChannelMemberType | null;
  default_assignee_id: string | null;
  position: number;
  created_by: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelMember {
  id: string;
  channel_id: string;
  member_type: ChannelMemberType;
  member_id: string;
  role: ChannelMemberRole;
  created_at: string;
}

export interface ChannelSession {
  id: string;
  channel_id: string;
  title: string;
  summary: string;
  status: ChannelSessionStatus;
  created_by_type: "member" | "agent" | "system";
  created_by_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelMessage {
  id: string;
  channel_id: string;
  session_id: string;
  author_type: "member" | "agent" | "system";
  author_id: string | null;
  content: string;
  type: ChannelMessageType;
  parent_id: string | null;
  issue_id: string | null;
  attachments: Attachment[];
  created_at: string;
  updated_at: string;
}

export interface ChannelAgentRun {
  id: string;
  channel_id: string;
  session_id: string;
  user_message_id: string;
  dispatch_step_id: string;
  agent_id: string;
  chat_session_id: string;
  chat_user_message_id: string;
  task_id: string;
  status: "queued" | "completed" | "failed";
  task_status: ChannelAgentTaskStatus;
  created_at: string;
  completed_at: string | null;
  task_created_at: string | null;
  task_started_at: string | null;
  task_completed_at: string | null;
}

export interface ChannelDispatchStep {
  id: string;
  plan_id: string;
  channel_id: string;
  session_id: string;
  trigger_message_id: string;
  agent_id: string;
  position: number;
  role: "participant" | "summarizer";
  status: ChannelDispatchStepStatus;
  instruction: string;
  depends_on_step_ids: string[];
  skip_reason: string;
  error: string;
  channel_agent_run_id: string;
  chat_session_id: string;
  chat_user_message_id: string;
  task_id: string;
  task_status: ChannelAgentTaskStatus | ChannelDispatchStepStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  task_created_at: string | null;
  task_started_at: string | null;
  task_completed_at: string | null;
}

export interface ChannelDispatchPlan {
  id: string;
  channel_id: string;
  session_id: string;
  trigger_message_id: string;
  mode: ChannelDispatchMode;
  status: ChannelDispatchPlanStatus;
  confidence: number;
  planner_source: "rules" | "model" | "fallback" | string;
  reason: string;
  participant_count: number;
  run_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_write_tokens: number;
  elapsed_ms: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  steps: ChannelDispatchStep[];
}

export interface ChannelIssue {
  issue_id: string;
  channel_id: string;
  session_id: string | null;
  linked_by_type: "member" | "agent" | "system";
  linked_by_id: string | null;
  identifier: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  created_at: string;
}

export interface ApprovalRequest {
  id: string;
  workspace_id: string;
  channel_id: string | null;
  session_id: string | null;
  issue_id: string | null;
  requested_by_type: "member" | "agent" | "system";
  requested_by_id: string | null;
  action_type: string;
  action_payload: Record<string, unknown>;
  status: ApprovalRequestStatus;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateChannelGroupRequest {
  name: string;
  position?: number;
}

export interface CreateChannelRequest {
  group_id?: string | null;
  slug?: string;
  name: string;
  description?: string;
  visibility?: ChannelVisibility;
  proactivity?: ChannelProactivity;
  mention_issue_search_enabled?: boolean;
  instructions?: string;
  summary?: string;
  default_project_id?: string | null;
  default_assignee_type?: ChannelMemberType | null;
  default_assignee_id?: string | null;
  position?: number;
  members?: Array<{
    member_type: ChannelMemberType;
    member_id: string;
    role?: ChannelMemberRole;
  }>;
}

export interface UpdateChannelRequest {
  group_id?: string | null;
  name?: string;
  description?: string;
  visibility?: ChannelVisibility;
  proactivity?: ChannelProactivity;
  mention_issue_search_enabled?: boolean;
  instructions?: string;
  summary?: string;
  default_project_id?: string | null;
  default_assignee_type?: ChannelMemberType | null;
  default_assignee_id?: string | null;
  position?: number;
}

export interface CreateChannelSessionRequest {
  title: string;
  summary?: string;
  status?: ChannelSessionStatus;
}

export interface CreateChannelMessageRequest {
  content: string;
  type?: ChannelMessageType;
  parent_id?: string | null;
  issue_id?: string | null;
  attachment_ids?: string[];
}

export interface AddChannelMemberRequest {
  member_type: ChannelMemberType;
  member_id: string;
  role?: ChannelMemberRole;
}

export interface LinkIssueToChannelRequest {
  issue_id: string;
  session_id?: string | null;
}

export interface CreateApprovalRequestRequest {
  session_id?: string | null;
  issue_id?: string | null;
  action_type: string;
  action_payload?: Record<string, unknown>;
}

export interface SkipChannelDispatchStepRequest {
  reason?: string;
}

export interface AddChannelDispatchAgentRequest {
  agent_id: string;
}

export interface ChangeChannelDispatchModeRequest {
  mode: ChannelDispatchMode;
}
