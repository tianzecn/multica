CREATE TABLE IF NOT EXISTS project_pull_request (
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    pull_request_id UUID NOT NULL REFERENCES github_pull_request(id) ON DELETE CASCADE,
    linked_by_type TEXT,
    linked_by_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, pull_request_id)
);

CREATE INDEX IF NOT EXISTS idx_project_pull_request_pull_request
    ON project_pull_request (pull_request_id);
