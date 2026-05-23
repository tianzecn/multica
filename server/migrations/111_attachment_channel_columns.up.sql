ALTER TABLE attachment
  ADD COLUMN channel_session_id UUID REFERENCES channel_session(id) ON DELETE CASCADE,
  ADD COLUMN channel_message_id UUID REFERENCES channel_message(id) ON DELETE CASCADE;

CREATE INDEX idx_attachment_channel_session
  ON attachment(channel_session_id)
  WHERE channel_session_id IS NOT NULL;

CREATE INDEX idx_attachment_channel_message
  ON attachment(channel_message_id)
  WHERE channel_message_id IS NOT NULL;
