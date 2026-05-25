ALTER TABLE channel
ADD COLUMN project_id UUID REFERENCES project(id) ON DELETE SET NULL;

UPDATE channel
SET project_id = default_project_id
WHERE default_project_id IS NOT NULL;

CREATE INDEX idx_channel_workspace_project_active
    ON channel(workspace_id, project_id, position, created_at)
    WHERE archived_at IS NULL;

INSERT INTO channel_read_state (
    channel_id,
    user_id,
    last_read_at,
    last_read_message_id
)
SELECT
    c.id,
    m.user_id,
    now(),
    latest_message.id
FROM channel c
JOIN member m
  ON m.workspace_id = c.workspace_id
LEFT JOIN LATERAL (
    SELECT cm.id
    FROM channel_message cm
    WHERE cm.channel_id = c.id
    ORDER BY cm.created_at DESC
    LIMIT 1
) latest_message ON true
WHERE c.archived_at IS NULL
  AND (
    c.visibility = 'public'
    OR m.role IN ('owner', 'admin')
    OR EXISTS (
        SELECT 1
        FROM channel_member cmem
        WHERE cmem.channel_id = c.id
          AND cmem.member_type = 'member'
          AND cmem.member_id = m.user_id
    )
  )
ON CONFLICT (channel_id, user_id) DO NOTHING;
