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
    instructions, summary, default_project_id, default_assignee_type,
    default_assignee_id, position, created_by
) VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10,
    $11, $12, $13
)
RETURNING *;

-- name: ListVisibleChannels :many
SELECT DISTINCT c.* FROM channel c
LEFT JOIN channel_member cm
       ON cm.channel_id = c.id
      AND cm.member_type = 'member'
      AND cm.member_id = $2
WHERE c.workspace_id = $1
  AND c.archived_at IS NULL
  AND (c.visibility = 'public' OR cm.id IS NOT NULL OR sqlc.arg('include_private')::boolean)
ORDER BY c.position ASC, c.created_at ASC;

-- name: GetChannelInWorkspace :one
SELECT * FROM channel
WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL;

-- name: GetChannelByID :one
SELECT * FROM channel
WHERE id = $1 AND archived_at IS NULL;

-- name: GetChannelBySlugInWorkspace :one
SELECT * FROM channel
WHERE slug = $1 AND workspace_id = $2 AND archived_at IS NULL;

-- name: UpdateChannel :one
UPDATE channel SET
    group_id = COALESCE(sqlc.narg('group_id'), group_id),
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    visibility = COALESCE(sqlc.narg('visibility'), visibility),
    instructions = COALESCE(sqlc.narg('instructions'), instructions),
    summary = COALESCE(sqlc.narg('summary'), summary),
    default_project_id = COALESCE(sqlc.narg('default_project_id'), default_project_id),
    default_assignee_type = COALESCE(sqlc.narg('default_assignee_type'), default_assignee_type),
    default_assignee_id = COALESCE(sqlc.narg('default_assignee_id'), default_assignee_id),
    position = COALESCE(sqlc.narg('position'), position),
    updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;

-- name: ArchiveChannel :one
UPDATE channel
SET archived_at = now(), updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;

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
WHERE channel_id = $1 AND archived_at IS NULL
ORDER BY updated_at DESC, created_at DESC;

-- name: GetChannelSession :one
SELECT cs.* FROM channel_session cs
JOIN channel c ON c.id = cs.channel_id
WHERE cs.id = $1 AND cs.channel_id = $2 AND c.workspace_id = $3 AND cs.archived_at IS NULL;

-- name: GetChannelSessionByID :one
SELECT * FROM channel_session
WHERE id = $1 AND archived_at IS NULL;

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
    chat_session_id, chat_user_message_id, task_id
) VALUES (
    $1, $2, $3, $4,
    $5, $6, $7
)
RETURNING *;

-- name: GetChannelAgentRunByTask :one
SELECT * FROM channel_agent_run
WHERE task_id = $1;

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
