CREATE TABLE channel_agent_thread (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
    channel_session_id UUID NOT NULL REFERENCES channel_session(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    chat_session_id UUID NOT NULL REFERENCES chat_session(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(channel_session_id, agent_id)
);

CREATE INDEX idx_channel_agent_thread_channel
    ON channel_agent_thread(channel_id);
CREATE INDEX idx_channel_agent_thread_chat_session
    ON channel_agent_thread(chat_session_id);

CREATE TABLE channel_agent_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
    channel_session_id UUID NOT NULL REFERENCES channel_session(id) ON DELETE CASCADE,
    user_message_id UUID NOT NULL REFERENCES channel_message(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    chat_session_id UUID REFERENCES chat_session(id) ON DELETE SET NULL,
    chat_user_message_id UUID REFERENCES chat_message(id) ON DELETE SET NULL,
    task_id UUID REFERENCES agent_task_queue(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'completed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    UNIQUE(task_id)
);

CREATE INDEX idx_channel_agent_run_message
    ON channel_agent_run(user_message_id);
CREATE INDEX idx_channel_agent_run_session
    ON channel_agent_run(channel_session_id, created_at DESC);
