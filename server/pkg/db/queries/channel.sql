-- name: CreateChannelGroup :one
INSERT INTO channel_group (workspace_id, name, position, created_by)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListChannelGroups :many
SELECT * FROM channel_group
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY position ASC, created_at ASC;

-- name: GetChannelGroupInWorkspace :one
SELECT * FROM channel_group
WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL;

-- name: CreateChannel :one
INSERT INTO channel (
    workspace_id, group_id, slug, name, description, visibility,
    proactivity, instructions, summary, project_id, default_project_id, default_assignee_type,
    default_assignee_id, position, created_by, mention_issue_search_enabled
) VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10, $10, $11,
    $12, $13, $14, $15
)
RETURNING *;

-- name: ListVisibleChannels :many
SELECT DISTINCT c.* FROM channel c
LEFT JOIN channel_member cm
       ON cm.channel_id = c.id
      AND cm.member_type = 'member'
      AND cm.member_id = $2
WHERE c.workspace_id = $1
  AND (sqlc.arg('include_archived')::boolean OR c.archived_at IS NULL)
  AND (c.visibility = 'public' OR cm.id IS NOT NULL OR sqlc.arg('include_private')::boolean)
ORDER BY c.position ASC, c.created_at ASC;

-- name: SearchVisibleChannels :many
SELECT c.* FROM channel c
WHERE c.workspace_id = sqlc.arg('workspace_id')
  AND c.archived_at IS NULL
  AND (
    c.visibility = 'public'
    OR sqlc.arg('include_private')::boolean
    OR EXISTS (
      SELECT 1
      FROM channel_member cm
      WHERE cm.channel_id = c.id
        AND cm.member_type = 'member'
        AND cm.member_id = sqlc.arg('member_id')
    )
  )
  AND (
    LOWER(c.name) LIKE sqlc.arg('pattern')
    OR LOWER(c.slug) LIKE sqlc.arg('pattern')
    OR LOWER(c.description) LIKE sqlc.arg('pattern')
  )
ORDER BY
  CASE
    WHEN LOWER(c.slug) = sqlc.arg('exact') THEN 0
    WHEN LOWER(c.name) = sqlc.arg('exact') THEN 1
    WHEN LOWER(c.slug) LIKE sqlc.arg('starts_with') THEN 2
    WHEN LOWER(c.name) LIKE sqlc.arg('starts_with') THEN 3
    ELSE 4
  END,
  c.position ASC,
  c.created_at ASC
LIMIT sqlc.arg('limit_count')::int;

-- name: GetChannelInWorkspace :one
SELECT * FROM channel
WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL;

-- name: GetChannelInWorkspaceAnyStatus :one
SELECT * FROM channel
WHERE id = $1 AND workspace_id = $2;

-- name: GetChannelByID :one
SELECT * FROM channel
WHERE id = $1 AND archived_at IS NULL;

-- name: GetChannelBySlugInWorkspace :one
SELECT * FROM channel
WHERE slug = $1 AND workspace_id = $2 AND archived_at IS NULL;

-- name: GetChannelBySlugInWorkspaceAnyStatus :one
SELECT * FROM channel
WHERE slug = $1 AND workspace_id = $2;

-- name: UpdateChannel :one
UPDATE channel SET
    group_id = COALESCE(sqlc.narg('group_id'), group_id),
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    visibility = COALESCE(sqlc.narg('visibility'), visibility),
    proactivity = COALESCE(sqlc.narg('proactivity'), proactivity),
    instructions = COALESCE(sqlc.narg('instructions'), instructions),
    summary = COALESCE(sqlc.narg('summary'), summary),
    project_id = CASE
        WHEN sqlc.arg('project_id_set')::boolean THEN sqlc.narg('project_id')
        ELSE project_id
    END,
    default_project_id = CASE
        WHEN sqlc.arg('project_id_set')::boolean THEN sqlc.narg('project_id')
        ELSE default_project_id
    END,
    default_assignee_type = COALESCE(sqlc.narg('default_assignee_type'), default_assignee_type),
    default_assignee_id = COALESCE(sqlc.narg('default_assignee_id'), default_assignee_id),
    position = COALESCE(sqlc.narg('position'), position),
    mention_issue_search_enabled = COALESCE(sqlc.narg('mention_issue_search_enabled'), mention_issue_search_enabled),
    updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;

-- name: ArchiveChannel :one
UPDATE channel
SET archived_at = now(), updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;

-- name: RestoreChannel :one
UPDATE channel
SET archived_at = NULL, updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;

-- name: DeleteArchivedChannel :execrows
DELETE FROM channel
WHERE id = $1
  AND workspace_id = $2
  AND archived_at IS NOT NULL;

-- name: AddChannelMember :one
INSERT INTO channel_member (channel_id, member_type, member_id, role)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpsertChannelMember :one
INSERT INTO channel_member (channel_id, member_type, member_id, role)
VALUES ($1, $2, $3, $4)
ON CONFLICT (channel_id, member_type, member_id)
DO UPDATE SET role = EXCLUDED.role
RETURNING *;

-- name: RemoveChannelMember :execrows
DELETE FROM channel_member
WHERE channel_id = $1 AND member_type = $2 AND member_id = $3;

-- name: GetChannelMember :one
SELECT * FROM channel_member
WHERE channel_id = $1 AND member_type = $2 AND member_id = $3;

-- name: ListChannelMembers :many
SELECT * FROM channel_member
WHERE channel_id = $1
ORDER BY created_at ASC;

-- name: IsChannelMember :one
SELECT EXISTS(
    SELECT 1 FROM channel_member
    WHERE channel_id = $1 AND member_type = $2 AND member_id = $3
) AS is_member;

-- name: CreateChannelSession :one
INSERT INTO channel_session (channel_id, title, summary, status, created_by_type, created_by_id)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListChannelSessions :many
SELECT * FROM channel_session
WHERE channel_id = $1
  AND (sqlc.arg('include_archived')::boolean OR archived_at IS NULL)
ORDER BY updated_at DESC, created_at DESC;

-- name: GetChannelSession :one
SELECT cs.* FROM channel_session cs
JOIN channel c ON c.id = cs.channel_id
WHERE cs.id = $1 AND cs.channel_id = $2 AND c.workspace_id = $3 AND cs.archived_at IS NULL;

-- name: GetChannelSessionByID :one
SELECT * FROM channel_session
WHERE id = $1 AND archived_at IS NULL;

-- name: ArchiveChannelSession :one
UPDATE channel_session
SET status = 'archived', archived_at = now(), updated_at = now()
WHERE id = $1 AND channel_id = $2
RETURNING *;

-- name: RestoreChannelSession :one
UPDATE channel_session
SET status = 'active', archived_at = NULL, updated_at = now()
WHERE id = $1 AND channel_id = $2
RETURNING *;

-- name: TouchChannelSession :exec
UPDATE channel_session
SET updated_at = now()
WHERE id = $1;

-- name: CreateChannelMessage :one
INSERT INTO channel_message (
    channel_id, session_id, author_type, author_id, content, type, parent_id, issue_id
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
)
RETURNING *;

-- name: ListChannelMessagesBySession :many
SELECT * FROM channel_message
WHERE channel_id = $1 AND session_id = $2
  AND (sqlc.narg('before')::timestamptz IS NULL OR created_at < sqlc.narg('before'))
ORDER BY created_at DESC
LIMIT $3;

-- name: GetChannelMessage :one
SELECT * FROM channel_message
WHERE id = $1;

-- name: LatestChannelMessageID :one
SELECT id FROM channel_message
WHERE channel_id = $1
ORDER BY created_at DESC
LIMIT 1;

-- name: ChannelHasUnreadForUser :one
SELECT EXISTS (
    SELECT 1
    FROM channel_message cm
    LEFT JOIN channel_read_state crs
      ON crs.channel_id = cm.channel_id
     AND crs.user_id = sqlc.arg('user_id')
    WHERE cm.channel_id = sqlc.arg('channel_id')
      AND cm.created_at > COALESCE(crs.last_read_at, '-infinity'::timestamptz)
      AND NOT (
        cm.author_type = 'member'
        AND cm.author_id = sqlc.arg('user_id')
      )
) AS has_unread;

-- name: ListUnreadChannelIDsForUser :many
SELECT DISTINCT cm.channel_id
FROM channel_message cm
LEFT JOIN channel_read_state crs
  ON crs.channel_id = cm.channel_id
 AND crs.user_id = sqlc.arg('user_id')
WHERE cm.channel_id = ANY(sqlc.arg('channel_ids')::uuid[])
  AND cm.created_at > COALESCE(crs.last_read_at, '-infinity'::timestamptz)
  AND NOT (
    cm.author_type = 'member'
    AND cm.author_id = sqlc.arg('user_id')
  );

-- name: GetChannelAgentThread :one
SELECT * FROM channel_agent_thread
WHERE channel_session_id = $1 AND agent_id = $2;

-- name: CreateChannelAgentThread :one
INSERT INTO channel_agent_thread (channel_id, channel_session_id, agent_id, chat_session_id)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: CreateChannelAgentRun :one
INSERT INTO channel_agent_run (
    channel_id, channel_session_id, user_message_id, agent_id,
    chat_session_id, chat_user_message_id, task_id, dispatch_step_id
) VALUES (
    $1, $2, $3, $4,
    $5, $6, $7, sqlc.narg('dispatch_step_id')
)
RETURNING *;

-- name: GetChannelAgentRunByTask :one
SELECT * FROM channel_agent_run
WHERE task_id = $1;

-- name: GetChannelAgentRunByDispatchStep :one
SELECT * FROM channel_agent_run
WHERE dispatch_step_id = $1
ORDER BY created_at DESC
LIMIT 1;

-- name: ListQueuedChannelAgentRunsForMessage :many
SELECT * FROM channel_agent_run
WHERE user_message_id = $1
  AND status = 'queued'
  AND task_id IS NULL
ORDER BY created_at ASC;

-- name: DispatchQueuedChannelAgentRun :one
UPDATE channel_agent_run
SET chat_session_id = $2,
    chat_user_message_id = $3,
    task_id = $4
WHERE id = $1
  AND status = 'queued'
  AND task_id IS NULL
RETURNING *;

-- name: ListChannelAgentRunsBySession :many
SELECT
    car.*,
    COALESCE(atq.status, car.status)::text AS task_status,
    atq.created_at AS task_created_at,
    atq.started_at AS task_started_at,
    atq.completed_at AS task_completed_at
FROM channel_agent_run car
LEFT JOIN agent_task_queue atq ON atq.id = car.task_id
WHERE car.channel_id = $1 AND car.channel_session_id = $2
ORDER BY car.created_at DESC;

-- name: CompleteChannelAgentRun :exec
UPDATE channel_agent_run
SET status = 'completed', completed_at = now()
WHERE id = $1;

-- name: FailChannelAgentRun :exec
UPDATE channel_agent_run
SET status = 'failed', completed_at = now()
WHERE id = $1;

-- name: CreateChannelDispatchPlan :one
INSERT INTO channel_dispatch_plan (
    channel_id, channel_session_id, trigger_message_id, mode, status,
    confidence, planner_source, reason, participant_count
) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9
)
RETURNING *;

-- name: GetChannelDispatchPlanInChannel :one
SELECT * FROM channel_dispatch_plan
WHERE id = $1 AND channel_id = $2;

-- name: GetChannelDispatchPlanByID :one
SELECT * FROM channel_dispatch_plan
WHERE id = $1;

-- name: ListChannelDispatchPlansBySession :many
SELECT * FROM channel_dispatch_plan
WHERE channel_id = $1 AND channel_session_id = $2
ORDER BY created_at DESC;

-- name: ListChannelDispatchPlansByTriggerMessage :many
SELECT * FROM channel_dispatch_plan
WHERE trigger_message_id = $1
ORDER BY created_at ASC;

-- name: UpdateChannelDispatchPlanStatus :one
UPDATE channel_dispatch_plan
SET status = $2,
    started_at = CASE WHEN $2 = 'running' AND started_at IS NULL THEN now() ELSE started_at END,
    completed_at = CASE WHEN $2 IN ('completed', 'failed', 'cancelled') THEN now() ELSE completed_at END,
    elapsed_ms = CASE
        WHEN $2 IN ('completed', 'failed', 'cancelled') AND started_at IS NOT NULL
        THEN GREATEST(0, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::bigint)
        ELSE elapsed_ms
    END,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ChangeChannelDispatchPlanMode :one
UPDATE channel_dispatch_plan
SET mode = $3,
    updated_at = now()
WHERE id = $1 AND channel_id = $2
RETURNING *;

-- name: RefreshChannelDispatchPlanStats :one
UPDATE channel_dispatch_plan p
SET run_count = stats.run_count,
    total_input_tokens = stats.input_tokens,
    total_output_tokens = stats.output_tokens,
    total_cache_read_tokens = stats.cache_read_tokens,
    total_cache_write_tokens = stats.cache_write_tokens,
    elapsed_ms = CASE
        WHEN p.started_at IS NULL THEN p.elapsed_ms
        WHEN p.completed_at IS NOT NULL THEN GREATEST(0, (EXTRACT(EPOCH FROM (p.completed_at - p.started_at)) * 1000)::bigint)
        ELSE GREATEST(0, (EXTRACT(EPOCH FROM (now() - p.started_at)) * 1000)::bigint)
    END,
    updated_at = now()
FROM (
    SELECT
        COUNT(car.id)::integer AS run_count,
        COALESCE(SUM(tu.input_tokens), 0)::bigint AS input_tokens,
        COALESCE(SUM(tu.output_tokens), 0)::bigint AS output_tokens,
        COALESCE(SUM(tu.cache_read_tokens), 0)::bigint AS cache_read_tokens,
        COALESCE(SUM(tu.cache_write_tokens), 0)::bigint AS cache_write_tokens
    FROM channel_dispatch_step cds
    LEFT JOIN channel_agent_run car ON car.dispatch_step_id = cds.id
    LEFT JOIN task_usage tu ON tu.task_id = car.task_id
    WHERE cds.plan_id = $1
) stats
WHERE p.id = $1
RETURNING p.*;

-- name: CreateChannelDispatchStep :one
INSERT INTO channel_dispatch_step (
    plan_id, channel_id, channel_session_id, trigger_message_id,
    agent_id, position, role, status, instruction, depends_on_step_ids,
    skip_reason
) VALUES (
    $1, $2, $3, $4,
    $5, $6, $7, $8, $9, $10,
    $11
)
RETURNING *;

-- name: GetChannelDispatchStepInChannel :one
SELECT * FROM channel_dispatch_step
WHERE id = $1 AND channel_id = $2;

-- name: GetChannelDispatchStepByTask :one
SELECT cds.* FROM channel_dispatch_step cds
JOIN channel_agent_run car ON car.dispatch_step_id = cds.id
WHERE car.task_id = $1
ORDER BY car.created_at DESC
LIMIT 1;

-- name: ListChannelDispatchStepsByPlan :many
SELECT
    cds.*,
    car.id AS channel_agent_run_id,
    car.chat_session_id,
    car.chat_user_message_id,
    car.task_id,
    COALESCE(atq.status, car.status, cds.status)::text AS task_status,
    atq.created_at AS task_created_at,
    atq.started_at AS task_started_at,
    atq.completed_at AS task_completed_at
FROM channel_dispatch_step cds
LEFT JOIN LATERAL (
    SELECT * FROM channel_agent_run
    WHERE dispatch_step_id = cds.id
    ORDER BY created_at DESC
    LIMIT 1
) car ON true
LEFT JOIN agent_task_queue atq ON atq.id = car.task_id
WHERE cds.plan_id = $1
ORDER BY cds.position ASC, cds.created_at ASC;

-- name: ListReadyChannelDispatchSteps :many
SELECT cds.* FROM channel_dispatch_step cds
WHERE cds.plan_id = $1
  AND cds.status = 'pending'
  AND NOT EXISTS (
      SELECT 1
      FROM unnest(cds.depends_on_step_ids) dep(step_id)
      JOIN channel_dispatch_step dependency ON dependency.id = dep.step_id
      WHERE dependency.status NOT IN ('completed', 'skipped')
  )
ORDER BY cds.position ASC, cds.created_at ASC;

-- name: ListIncompleteChannelDispatchSteps :many
SELECT * FROM channel_dispatch_step
WHERE plan_id = $1
  AND status IN ('pending', 'queued', 'running')
ORDER BY position ASC, created_at ASC;

-- name: UpdateChannelDispatchStepStatus :one
UPDATE channel_dispatch_step
SET status = $2,
    error = COALESCE(sqlc.narg('error'), error),
    skip_reason = COALESCE(sqlc.narg('skip_reason'), skip_reason),
    started_at = CASE WHEN $2 IN ('queued', 'running') AND started_at IS NULL THEN now() ELSE started_at END,
    completed_at = CASE WHEN $2 IN ('completed', 'failed', 'skipped', 'cancelled') THEN now() ELSE completed_at END,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: CancelPendingChannelDispatchSteps :execrows
UPDATE channel_dispatch_step
SET status = 'cancelled',
    skip_reason = CASE WHEN skip_reason = '' THEN 'Plan cancelled.' ELSE skip_reason END,
    completed_at = now(),
    updated_at = now()
WHERE plan_id = $1
  AND status = 'pending';

-- name: ResetChannelDispatchStepForRetry :one
UPDATE channel_dispatch_step
SET status = 'pending',
    error = '',
    skip_reason = '',
    started_at = NULL,
    completed_at = NULL,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: CreateChannelDispatchFeedback :one
INSERT INTO channel_dispatch_feedback (
    plan_id, step_id, actor_type, actor_id, action, before_mode, after_mode, payload
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
)
RETURNING *;

-- name: LinkIssueToChannel :one
INSERT INTO issue_channel (issue_id, channel_id, session_id, linked_by_type, linked_by_id)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (issue_id, channel_id)
DO UPDATE SET session_id = COALESCE(EXCLUDED.session_id, issue_channel.session_id)
RETURNING *;

-- name: UnlinkIssueFromChannel :execrows
DELETE FROM issue_channel
WHERE issue_id = $1 AND channel_id = $2;

-- name: ListChannelIssues :many
SELECT ic.issue_id, ic.channel_id, ic.session_id, ic.linked_by_type, ic.linked_by_id, ic.created_at,
       i.number, i.title, i.status, i.priority
FROM issue_channel ic
JOIN issue i ON i.id = ic.issue_id
WHERE ic.channel_id = $1
ORDER BY ic.created_at DESC;

-- name: ListIssueChannels :many
SELECT ic.issue_id, ic.channel_id, ic.session_id, ic.linked_by_type, ic.linked_by_id, ic.created_at,
       c.slug, c.name, c.visibility
FROM issue_channel ic
JOIN channel c ON c.id = ic.channel_id
WHERE ic.issue_id = $1
ORDER BY ic.created_at DESC;

-- name: UpsertChannelReadState :one
INSERT INTO channel_read_state (channel_id, user_id, last_read_at, last_read_message_id)
VALUES ($1, $2, now(), $3)
ON CONFLICT (channel_id, user_id)
DO UPDATE SET last_read_at = now(), last_read_message_id = EXCLUDED.last_read_message_id
RETURNING *;

-- name: CreateApprovalRequest :one
INSERT INTO approval_request (
    workspace_id, channel_id, session_id, issue_id, requested_by_type,
    requested_by_id, action_type, action_payload
) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8
)
RETURNING *;

-- name: ListApprovalRequestsForChannel :many
SELECT * FROM approval_request
WHERE channel_id = $1
ORDER BY created_at DESC;

-- name: GetApprovalRequestInChannel :one
SELECT * FROM approval_request
WHERE id = $1 AND workspace_id = $2 AND channel_id = $3;

-- name: ResolveApprovalRequest :one
UPDATE approval_request SET
    status = $3,
    resolution_note = $4,
    resolved_by = $5,
    resolved_at = now(),
    updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;
