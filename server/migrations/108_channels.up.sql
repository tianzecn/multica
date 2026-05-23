CREATE TABLE channel_group (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_by UUID REFERENCES "user"(id) ON DELETE SET NULL,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_channel_group_workspace_name_lower
    ON channel_group(workspace_id, lower(name))
    WHERE archived_at IS NULL;
CREATE INDEX idx_channel_group_workspace ON channel_group(workspace_id);

CREATE TABLE channel (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    group_id UUID REFERENCES channel_group(id) ON DELETE SET NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
    instructions TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    default_project_id UUID REFERENCES project(id) ON DELETE SET NULL,
    default_assignee_type TEXT CHECK (default_assignee_type IN ('member', 'agent', 'squad')),
    default_assignee_id UUID,
    position DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_by UUID NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(workspace_id, slug)
);

CREATE INDEX idx_channel_workspace ON channel(workspace_id);
CREATE INDEX idx_channel_group ON channel(group_id);
CREATE INDEX idx_channel_visibility ON channel(workspace_id, visibility);

CREATE TABLE channel_member (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
    member_type TEXT NOT NULL CHECK (member_type IN ('member', 'agent', 'squad')),
    member_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(channel_id, member_type, member_id)
);

CREATE INDEX idx_channel_member_channel ON channel_member(channel_id);
CREATE INDEX idx_channel_member_entity ON channel_member(member_type, member_id);

CREATE TABLE channel_session (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'archived')),
    created_by_type TEXT NOT NULL CHECK (created_by_type IN ('member', 'agent', 'system')),
    created_by_id UUID,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_channel_session_channel ON channel_session(channel_id, updated_at DESC);

CREATE TABLE channel_message (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES channel_session(id) ON DELETE CASCADE,
    author_type TEXT NOT NULL CHECK (author_type IN ('member', 'agent', 'system')),
    author_id UUID,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'message' CHECK (type IN ('message', 'system', 'suggestion', 'approval')),
    parent_id UUID REFERENCES channel_message(id) ON DELETE CASCADE,
    issue_id UUID REFERENCES issue(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_channel_message_session ON channel_message(session_id, created_at ASC);
CREATE INDEX idx_channel_message_channel ON channel_message(channel_id, created_at DESC);
CREATE INDEX idx_channel_message_issue ON channel_message(issue_id);

CREATE TABLE issue_channel (
    issue_id UUID NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
    session_id UUID REFERENCES channel_session(id) ON DELETE SET NULL,
    linked_by_type TEXT NOT NULL CHECK (linked_by_type IN ('member', 'agent', 'system')),
    linked_by_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(issue_id, channel_id)
);

CREATE INDEX idx_issue_channel_channel ON issue_channel(channel_id);
CREATE INDEX idx_issue_channel_session ON issue_channel(session_id);

CREATE TABLE channel_read_state (
    channel_id UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ,
    last_read_message_id UUID REFERENCES channel_message(id) ON DELETE SET NULL,
    PRIMARY KEY(channel_id, user_id)
);

CREATE TABLE approval_request (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES channel(id) ON DELETE CASCADE,
    session_id UUID REFERENCES channel_session(id) ON DELETE SET NULL,
    issue_id UUID REFERENCES issue(id) ON DELETE SET NULL,
    requested_by_type TEXT NOT NULL CHECK (requested_by_type IN ('member', 'agent', 'system')),
    requested_by_id UUID,
    action_type TEXT NOT NULL,
    action_payload JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'executed', 'failed')),
    resolution_note TEXT,
    resolved_by UUID REFERENCES "user"(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_request_workspace ON approval_request(workspace_id, created_at DESC);
CREATE INDEX idx_approval_request_channel ON approval_request(channel_id, created_at DESC);
CREATE INDEX idx_approval_request_session ON approval_request(session_id, created_at DESC);
CREATE INDEX idx_approval_request_issue ON approval_request(issue_id);
