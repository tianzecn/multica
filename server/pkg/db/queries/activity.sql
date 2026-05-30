-- name: ListActivitiesForIssue :many
-- All activities for an issue in chronological order, capped at $2 (DB safety
-- net to bound the response).
SELECT * FROM activity_log
WHERE issue_id = $1
ORDER BY created_at ASC, id ASC
LIMIT $2;

-- name: ListActivitiesForProject :many
-- Project-scoped activities are stored as workspace-level rows with no issue
-- and a project_id marker inside details, so repo/folder unbinds do not erase
-- history while project deletion still cascades through details governance.
SELECT * FROM activity_log
WHERE workspace_id = $1
  AND issue_id IS NULL
  AND details->>'project_id' = sqlc.arg('project_id')::text
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg('limit');

-- name: DeleteActivitiesForProject :exec
DELETE FROM activity_log
WHERE workspace_id = $1
  AND details->>'project_id' = sqlc.arg('project_id')::text;

-- name: ListActivitiesForProjectExport :many
-- Export uses chronological order so downstream archive readers can replay the
-- Project history directly, including redacted diff payloads stored in details.
SELECT * FROM activity_log
WHERE workspace_id = $1
  AND issue_id IS NULL
  AND details->>'project_id' = sqlc.arg('project_id')::text
ORDER BY created_at ASC, id ASC
LIMIT sqlc.arg('limit');

-- name: GetActivity :one
SELECT * FROM activity_log
WHERE id = $1;

-- name: CreateActivity :one
INSERT INTO activity_log (
    workspace_id, issue_id, actor_type, actor_id, action, details
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: HasSquadLeaderNoActionEvaluationForTask :one
SELECT EXISTS (
  SELECT 1
  FROM activity_log
  WHERE issue_id = @issue_id
    AND actor_type = 'agent'
    AND actor_id = @agent_id
    AND action = 'squad_leader_evaluated'
    AND details->>'outcome' = 'no_action'
    AND details->>'task_id' = @task_id::text
) AS exists;

-- name: CountAssigneeChangesByActor :many
-- Count how many times a user assigned each target via assignee_changed activities.
SELECT
  details->>'to_type' as assignee_type,
  details->>'to_id' as assignee_id,
  COUNT(*)::bigint as frequency
FROM activity_log
WHERE workspace_id = $1
  AND actor_id = $2
  AND actor_type = 'member'
  AND action = 'assignee_changed'
  AND details->>'to_type' IS NOT NULL
  AND details->>'to_id' IS NOT NULL
GROUP BY details->>'to_type', details->>'to_id';
