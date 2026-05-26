-- Backfill project repository role semantics:
-- the first github_repo per project becomes primary; remaining repos become
-- related context. New writes are normalized by the API validator.
WITH ranked AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY project_id
            ORDER BY position ASC, created_at ASC, id ASC
        ) AS repo_rank
    FROM project_resource
    WHERE resource_type = 'github_repo'
)
UPDATE project_resource pr
SET resource_ref = jsonb_set(
    pr.resource_ref,
    '{role}',
    to_jsonb(CASE WHEN ranked.repo_rank = 1 THEN 'primary' ELSE 'related' END::text),
    true
)
FROM ranked
WHERE pr.id = ranked.id
  AND NOT (pr.resource_ref ? 'role');

CREATE UNIQUE INDEX idx_project_resource_github_repo_url
    ON project_resource (project_id, ((resource_ref->>'url')))
    WHERE resource_type = 'github_repo';

CREATE UNIQUE INDEX idx_project_resource_primary_github_repo
    ON project_resource (project_id)
    WHERE resource_type = 'github_repo'
      AND resource_ref->>'role' = 'primary';
