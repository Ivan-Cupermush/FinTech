-- Интеграции: замеры KPI из 1С и Moodle по расписанию.
-- Одно подключение пишет в один KPI. Пароль или токен хранится только здесь
-- и наружу не отдаётся: API показывает лишь, что он задан, и маску.
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  metric_id UUID NOT NULL REFERENCES goal_metrics(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('onec', 'moodle')),
  name VARCHAR(120) NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  config JSONB NOT NULL,
  -- Логин 1С. У Moodle вместо логина и пароля — токен веб-сервиса.
  username VARCHAR(120),
  secret TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  interval_hours INT NOT NULL DEFAULT 24 CHECK (interval_hours IN (1, 6, 24, 168)),
  last_sync_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_integrations_company ON integrations (company_id, created_at);
CREATE INDEX idx_integrations_due ON integrations (last_sync_at) WHERE enabled;

-- Журнал запусков: когда, по расписанию или вручную, сколько пришло и записано.
CREATE TABLE integration_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  trigger VARCHAR(10) NOT NULL CHECK (trigger IN ('manual', 'schedule')),
  started_by UUID REFERENCES users(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(10) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  fetched INT NOT NULL DEFAULT 0,
  imported INT NOT NULL DEFAULT 0,
  skipped INT NOT NULL DEFAULT 0,
  error TEXT,
  -- Порядок запусков с одинаковым started_at (часы в тестах и демо стоят).
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_integration_runs_integration ON integration_runs (integration_id, started_at DESC);
