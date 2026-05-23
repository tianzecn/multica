ALTER TABLE channel
ADD COLUMN proactivity TEXT NOT NULL DEFAULT 'active'
CHECK (proactivity IN ('quiet', 'standard', 'active'));

CREATE TABLE channel_dispatch_plan (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
    channel_session_id UUID NOT NULL REFERENCES channel_session(id) ON DELETE CASCADE,
    trigger_message_id UUID NOT NULL REFERENCES channel_message(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('single', 'parallel', 'serial', 'roundtable')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'paused', 'failed', 'cancelled')),
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    planner_source TEXT NOT NULL DEFAULT 'rules' CHECK (planner_source IN ('rules', 'model', 'fallback')),
    reason TEXT NOT NULL DEFAULT '',
    participant_count INTEGER NOT NULL DEFAULT 0,
    run_count INTEGER NOT NULL DEFAULT 0,
    total_input_tokens BIGINT NOT NULL DEFAULT 0,
    total_output_tokens BIGINT NOT NULL DEFAULT 0,
    total_cache_read_tokens BIGINT NOT NULL DEFAULT 0,
    total_cache_write_tokens BIGINT NOT NULL DEFAULT 0,
    elapsed_ms BIGINT NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_channel_dispatch_plan_session
    ON channel_dispatch_plan(channel_session_id, created_at DESC);
CREATE INDEX idx_channel_dispatch_plan_trigger
    ON channel_dispatch_plan(trigger_message_id);
CREATE INDEX idx_channel_dispatch_plan_channel_status
    ON channel_dispatch_plan(channel_id, status, created_at DESC);

CREATE TABLE channel_dispatch_step (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES channel_dispatch_plan(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
    channel_session_id UUID NOT NULL REFERENCES channel_session(id) ON DELETE CASCADE,
    trigger_message_id UUID NOT NULL REFERENCES channel_message(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('participant', 'summarizer')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'skipped', 'cancelled')),
    instruction TEXT NOT NULL DEFAULT '',
    depends_on_step_ids UUID[] NOT NULL DEFAULT '{}',
    skip_reason TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_channel_dispatch_step_plan
    ON channel_dispatch_step(plan_id, position ASC);
CREATE INDEX idx_channel_dispatch_step_status
    ON channel_dispatch_step(plan_id, status);
CREATE INDEX idx_channel_dispatch_step_agent
    ON channel_dispatch_step(agent_id, created_at DESC);

ALTER TABLE channel_agent_run
ADD COLUMN dispatch_step_id UUID REFERENCES channel_dispatch_step(id) ON DELETE SET NULL;

CREATE INDEX idx_channel_agent_run_dispatch_step
    ON channel_agent_run(dispatch_step_id);

CREATE TABLE channel_dispatch_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES channel_dispatch_plan(id) ON DELETE CASCADE,
    step_id UUID REFERENCES channel_dispatch_step(id) ON DELETE SET NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('member', 'agent', 'system')),
    actor_id UUID,
    action TEXT NOT NULL,
    before_mode TEXT,
    after_mode TEXT,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_channel_dispatch_feedback_plan
    ON channel_dispatch_feedback(plan_id, created_at DESC);
