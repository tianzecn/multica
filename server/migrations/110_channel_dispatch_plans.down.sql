DROP TABLE IF EXISTS channel_dispatch_feedback;

DROP INDEX IF EXISTS idx_channel_agent_run_dispatch_step;
ALTER TABLE channel_agent_run
DROP COLUMN IF EXISTS dispatch_step_id;

DROP TABLE IF EXISTS channel_dispatch_step;
DROP TABLE IF EXISTS channel_dispatch_plan;

ALTER TABLE channel
DROP COLUMN IF EXISTS proactivity;
