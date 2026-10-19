-- Push-уведомления: устройства, настройки человека и очередь отправки.
-- Очередь — сами уведомления: push_state IS NULL значит «ещё не решали».
-- Уведомление и его push пишутся в одной транзакции с действием, поэтому
-- push не уйдёт по откатившейся операции и не потеряется при сбое отправки.

CREATE TABLE push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(200) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at TIMESTAMPTZ
);
CREATE INDEX idx_push_devices_user ON push_devices (user_id, company_id) WHERE disabled_at IS NULL;

CREATE TABLE push_settings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  muted TEXT[] NOT NULL DEFAULT '{}',
  quiet_hours BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, company_id)
);

ALTER TABLE notifications ADD COLUMN push_state VARCHAR(12) CHECK (push_state IN ('sending', 'sent', 'skipped', 'failed'));
ALTER TABLE notifications ADD COLUMN pushed_at TIMESTAMPTZ;
-- Старые уведомления на телефон не шлём: они уже лежат во «Входящих».
UPDATE notifications SET push_state = 'skipped';
CREATE INDEX idx_notifications_push_pending ON notifications (created_at) WHERE push_state IS NULL;
