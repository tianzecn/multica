DROP INDEX IF EXISTS idx_attachment_channel_message;
DROP INDEX IF EXISTS idx_attachment_channel_session;
ALTER TABLE attachment
  DROP COLUMN channel_message_id,
  DROP COLUMN channel_session_id;
