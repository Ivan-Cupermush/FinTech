-- Защита данных: журнал входов (защита от подбора, история входов),
-- согласие на обработку персональных данных и обезличивание ушедших.

CREATE TABLE login_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  ok BOOLEAN NOT NULL,
  method VARCHAR(12) NOT NULL CHECK (method IN ('password', 'qr', 'register')),
  failure VARCHAR(16) CHECK (failure IN ('bad_password', 'locked', 'inactive')),
  ip VARCHAR(64),
  user_agent VARCHAR(400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ok = (failure IS NULL))
);
CREATE INDEX idx_login_events_user ON login_events (user_id, created_at DESC);
CREATE INDEX idx_login_events_company ON login_events (company_id, created_at DESC);

ALTER TABLE users ADD COLUMN consent_version VARCHAR(20);
ALTER TABLE users ADD COLUMN consent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN anonymized_at TIMESTAMPTZ;

CREATE INDEX idx_audit_events_company_time ON audit_events (company_id, created_at DESC);
