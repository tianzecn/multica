-- name: GetProjectWorkspaceConfig :one
SELECT *
FROM project_workspace_config
WHERE project_id = $1 AND workspace_id = $2;

-- name: UpsertProjectWorkspaceConfig :one
INSERT INTO project_workspace_config (
    project_id,
    workspace_id,
    base_branch,
    scope_path,
    verification_commands,
    run_scripts
) VALUES (
    $1, $2, $3, $4, $5, $6
)
ON CONFLICT (project_id)
DO UPDATE SET
    base_branch = EXCLUDED.base_branch,
    scope_path = EXCLUDED.scope_path,
    verification_commands = EXCLUDED.verification_commands,
    run_scripts = EXCLUDED.run_scripts,
    updated_at = now()
WHERE project_workspace_config.workspace_id = EXCLUDED.workspace_id
RETURNING *;

-- name: ListProjectDeviceBindings :many
SELECT
    pdb.*,
    ar.name AS runtime_name,
    ar.status AS runtime_status,
    ar.last_seen_at AS runtime_last_seen_at
FROM project_device_binding pdb
LEFT JOIN agent_runtime ar ON ar.id = pdb.runtime_id
WHERE pdb.project_id = $1 AND pdb.workspace_id = $2
ORDER BY
    CASE COALESCE(ar.status, pdb.status)
        WHEN 'online' THEN 0
        WHEN 'unknown' THEN 1
        ELSE 2
    END,
    pdb.updated_at DESC;

-- name: UpsertProjectDeviceBinding :one
INSERT INTO project_device_binding (
    project_id,
    workspace_id,
    runtime_id,
    device_id,
    primary_repo_url,
    status,
    capabilities,
    path_alias,
    path_basename,
    last_seen_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
)
ON CONFLICT (project_id, device_id)
DO UPDATE SET
    runtime_id = EXCLUDED.runtime_id,
    primary_repo_url = EXCLUDED.primary_repo_url,
    status = EXCLUDED.status,
    capabilities = EXCLUDED.capabilities,
    path_alias = EXCLUDED.path_alias,
    path_basename = EXCLUDED.path_basename,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = now()
WHERE project_device_binding.workspace_id = EXCLUDED.workspace_id
RETURNING *;

-- name: DeleteProjectDeviceBinding :execrows
DELETE FROM project_device_binding
WHERE project_id = $1 AND workspace_id = $2 AND device_id = $3;
