CREATE TABLE project_workspace_config (
    project_id UUID PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    base_branch TEXT NOT NULL DEFAULT 'main',
    scope_path TEXT NOT NULL DEFAULT '',
    verification_commands JSONB NOT NULL DEFAULT '[]'::jsonb,
    run_scripts JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_workspace_config_workspace
    ON project_workspace_config(workspace_id);

CREATE TABLE project_device_binding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    runtime_id UUID REFERENCES agent_runtime(id) ON DELETE SET NULL,
    device_id TEXT NOT NULL,
    primary_repo_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (status IN ('online', 'offline', 'unknown', 'error')),
    capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
    path_alias TEXT NOT NULL DEFAULT '',
    path_basename TEXT NOT NULL DEFAULT '',
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, device_id)
);

CREATE INDEX idx_project_device_binding_project
    ON project_device_binding(project_id, status, updated_at DESC);

CREATE INDEX idx_project_device_binding_workspace
    ON project_device_binding(workspace_id);

CREATE INDEX idx_project_device_binding_runtime
    ON project_device_binding(runtime_id)
    WHERE runtime_id IS NOT NULL;
