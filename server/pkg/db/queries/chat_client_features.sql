-- Local client feature queries kept separate from the upstream query set.
-- sqlc loads every .sql file in this directory.

-- name: SetUnreadSinceIfNull :exec
-- Atomically stamps the first unread assistant message's arrival time.
-- No-op if the session is already in "has unread" state — keeps the earliest
-- unread boundary stable across multiple incoming replies.
UPDATE chat_session SET unread_since = now()
WHERE id = $1 AND unread_since IS NULL;

-- name: UpdateChatSessionTitle :one
UPDATE chat_session
SET title = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SearchChatSessionsByCreator :many
SELECT cs.*,
       (cs.unread_since IS NOT NULL)::bool AS has_unread
FROM chat_session cs
JOIN agent a ON a.id = cs.agent_id
LEFT JOIN project p ON p.id = cs.project_id
WHERE cs.workspace_id = $1
  AND cs.creator_id = $2
  AND cs.status = 'active'
  AND (
    cs.title ILIKE '%' || sqlc.arg('query')::text || '%'
    OR a.name ILIKE '%' || sqlc.arg('query')::text || '%'
    OR p.title ILIKE '%' || sqlc.arg('query')::text || '%'
  )
ORDER BY cs.updated_at DESC
LIMIT $3;
