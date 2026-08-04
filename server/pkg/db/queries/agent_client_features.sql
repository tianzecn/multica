-- Local client feature queries kept separate from the upstream query set.
-- sqlc loads every .sql file in this directory.

-- name: GetLatestTaskIsLeaderForIssueAndAgent :one
-- Returns the is_leader_task flag of the agent's most recent task on this
-- issue, or NULL if the agent has never had a task on this issue. Used by
-- the squad-leader self-trigger guard to tell whether the agent's last
-- activity on the issue was in the leader role or the worker role (an
-- agent that holds both roles in a squad would otherwise be skipped by
-- the role-blind authorID == leaderID check).
SELECT is_leader_task FROM agent_task_queue
WHERE issue_id = $1 AND agent_id = $2
ORDER BY created_at DESC
LIMIT 1;
