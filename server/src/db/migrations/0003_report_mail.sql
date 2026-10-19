-- Отчёт для руководства по почте: подписка человека в компании.
-- since_at — с какого момента считать расписание: при включении подписки
-- или смене частоты первое письмо придёт в ближайший слот, а не задним числом.
-- last_sent_at пишется в той же транзакции, что и отправка, поэтому письмо
-- за один слот не уходит дважды.

CREATE TABLE report_subscriptions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  schedule VARCHAR(10) NOT NULL CHECK (schedule IN ('weekly', 'monthly')),
  since_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, company_id)
);
CREATE INDEX idx_report_subscriptions_enabled ON report_subscriptions (schedule) WHERE enabled;
