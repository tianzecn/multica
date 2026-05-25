DROP INDEX IF EXISTS idx_channel_workspace_project_active;

ALTER TABLE channel
DROP COLUMN IF EXISTS project_id;
