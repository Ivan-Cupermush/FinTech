-- offix: компании, люди, оргструктура, цели с KPI, задачи, аудит.
-- Все сущности привязаны к компании: данные организаций изолированы.
-- Составные внешние ключи (id, company_id) не дают сослаться на объект
-- другой компании даже при ошибке в коде.

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 150),
  -- Режим настройки влияет только на подсказки интерфейса, модель одна.
  setup_mode VARCHAR(20) NOT NULL DEFAULT 'quick' CHECK (setup_mode IN ('quick', 'structured')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  display_name VARCHAR(120) NOT NULL CHECK (char_length(trim(display_name)) BETWEEN 1 AND 120),
  position VARCHAR(120),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_users_email ON users (lower(email));

CREATE TABLE company_members (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'member', 'observer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, user_id)
);
CREATE INDEX idx_company_members_user ON company_members (user_id);

CREATE TABLE org_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  parent_unit_id UUID,
  name VARCHAR(150) NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 150),
  unit_type VARCHAR(30) NOT NULL CHECK (unit_type IN ('division', 'department', 'team')),
  description TEXT,
  color VARCHAR(7),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, company_id),
  FOREIGN KEY (parent_unit_id, company_id) REFERENCES org_units(id, company_id) ON DELETE RESTRICT,
  CHECK (parent_unit_id IS NULL OR parent_unit_id <> id)
);
CREATE INDEX idx_org_units_company_parent ON org_units (company_id, parent_unit_id);

-- Членство вместо department_id у пользователя: несколько команд, основное
-- подразделение, даты участия и история переходов.
CREATE TABLE org_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL,
  is_manager BOOLEAN NOT NULL DEFAULT FALSE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  started_at DATE NOT NULL DEFAULT CURRENT_DATE,
  ended_at DATE,
  FOREIGN KEY (unit_id, company_id) REFERENCES org_units(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, user_id) REFERENCES company_members(company_id, user_id) ON DELETE CASCADE,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX uq_org_memberships_active ON org_memberships (user_id, unit_id) WHERE ended_at IS NULL;
CREATE INDEX idx_org_memberships_unit ON org_memberships (unit_id) WHERE ended_at IS NULL;

CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  parent_goal_id UUID,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  goal_type VARCHAR(20) NOT NULL CHECK (goal_type IN ('strategic', 'operational', 'personal')),
  -- Владелец может отсутствовать только у черновика (проверка ниже).
  owner_id UUID REFERENCES users(id),
  created_by UUID NOT NULL REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'cancelled', 'on_hold')),
  due_at DATE,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, company_id),
  FOREIGN KEY (parent_goal_id, company_id) REFERENCES goals(id, company_id) ON DELETE RESTRICT,
  CHECK (parent_goal_id IS NULL OR parent_goal_id <> id),
  CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  CHECK (description IS NULL OR char_length(description) <= 5000),
  CHECK (status = 'draft' OR status = 'cancelled' OR (owner_id IS NOT NULL AND due_at IS NOT NULL))
);
CREATE INDEX idx_goals_company_status ON goals (company_id, status);
CREATE INDEX idx_goals_owner_status ON goals (owner_id, status);
CREATE INDEX idx_goals_parent ON goals (parent_goal_id);
CREATE INDEX idx_goals_due_active ON goals (due_at) WHERE status = 'active';

-- NUMERIC, а не FLOAT: без проблем двоичной точности для денег и замеров.
CREATE TABLE goal_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  unit VARCHAR(30) NOT NULL,
  baseline NUMERIC(18, 4) NOT NULL,
  target_value NUMERIC(18, 4) NOT NULL,
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('increase', 'decrease', 'maintain')),
  range_min NUMERIC(18, 4),
  range_max NUMERIC(18, 4),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(trim(name)) BETWEEN 1 AND 100),
  CHECK (char_length(trim(unit)) BETWEEN 1 AND 30),
  CHECK (baseline > '-Infinity'::NUMERIC AND baseline < 'Infinity'::NUMERIC
     AND target_value > '-Infinity'::NUMERIC AND target_value < 'Infinity'::NUMERIC),
  CHECK (direction <> 'maintain' OR (range_min IS NOT NULL AND range_max IS NOT NULL AND range_min <= range_max))
);
CREATE INDEX idx_goal_metrics_goal ON goal_metrics (goal_id);

-- История фактических измерений. baseline и target её не заменяют.
CREATE TABLE goal_metric_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id UUID NOT NULL REFERENCES goal_metrics(id) ON DELETE CASCADE,
  value NUMERIC(18, 4) NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(30) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'integration')),
  recorded_by UUID REFERENCES users(id),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (value > '-Infinity'::NUMERIC AND value < 'Infinity'::NUMERIC)
);
CREATE INDEX idx_metric_observations_time ON goal_metric_observations (metric_id, observed_at DESC);

-- Подразделения, участвующие в цели, и их роль: отвечает, исполняет, согласует, участвует.
CREATE TABLE goal_org_units (
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES org_units(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'contributor' CHECK (role IN ('owner', 'executor', 'approver', 'contributor')),
  PRIMARY KEY (goal_id, unit_id)
);
CREATE INDEX idx_goal_org_units_unit ON goal_org_units (unit_id);

-- Третий слой прав: явный доступ человека к цели.
CREATE TABLE goal_participants (
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'contributor' CHECK (role IN ('contributor', 'approver', 'viewer')),
  PRIMARY KEY (goal_id, user_id)
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 5000),
  status VARCHAR(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled')),
  assignee_id UUID REFERENCES users(id),
  team_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL,
  unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL,
  start_at DATE,
  due_at DATE,
  done_at TIMESTAMPTZ,
  definition_of_done TEXT CHECK (definition_of_done IS NULL OR char_length(definition_of_done) <= 2000),
  blocked_reason VARCHAR(20) CHECK (blocked_reason IN ('approval', 'data', 'technical', 'colleague', 'resources', 'other')),
  blocked_note VARCHAR(500),
  blocked_since TIMESTAMPTZ,
  next_step VARCHAR(500),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, company_id),
  CHECK (start_at IS NULL OR due_at IS NULL OR start_at <= due_at),
  CHECK (status <> 'blocked' OR blocked_reason IS NOT NULL)
);
CREATE INDEX idx_tasks_company_status ON tasks (company_id, status);
CREATE INDEX idx_tasks_assignee ON tasks (assignee_id, status);

CREATE TABLE task_dependencies (
  company_id UUID NOT NULL,
  from_task_id UUID NOT NULL,
  to_task_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (from_task_id, to_task_id),
  FOREIGN KEY (from_task_id, company_id) REFERENCES tasks(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (to_task_id, company_id) REFERENCES tasks(id, company_id) ON DELETE CASCADE,
  CHECK (from_task_id <> to_task_id)
);
CREATE INDEX idx_task_dependencies_to ON task_dependencies (to_task_id);

-- Владелец, исполняющая команда, согласующие — три вида участия, а не три владельца.
CREATE TABLE task_participants (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'executor', 'approver', 'contributor')),
  PRIMARY KEY (task_id, user_id, role)
);

CREATE TABLE task_status_events (
  id BIGSERIAL PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL,
  blocked_reason VARCHAR(20),
  note VARCHAR(500),
  actor_id UUID REFERENCES users(id),
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_task_status_events_task ON task_status_events (task_id, at);

-- Задачи не копируются в дорожную карту — только связываются с целями.
CREATE TABLE goal_tasks (
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  contribution_weight NUMERIC(8, 4) CHECK (contribution_weight IS NULL OR contribution_weight BETWEEN 0 AND 1),
  linked_by UUID REFERENCES users(id),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (goal_id, task_id)
);
CREATE INDEX idx_goal_tasks_task ON goal_tasks (task_id);

CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('goal', 'task')),
  entity_id UUID NOT NULL,
  author_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_comments_entity ON comments (entity_type, entity_id, created_at);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(30) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body VARCHAR(1000),
  goal_id UUID REFERENCES goals(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);

-- Журнал аудита: только добавление. Изменить или удалить запись нельзя —
-- это запрещает триггер, а не код приложения.
CREATE TABLE audit_events (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  entity_type VARCHAR(20) NOT NULL,
  entity_id UUID NOT NULL,
  goal_id UUID REFERENCES goals(id) ON DELETE RESTRICT,
  actor_id UUID REFERENCES users(id),
  event_type VARCHAR(50) NOT NULL,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_events_goal_time ON audit_events (goal_id, created_at DESC);
CREATE INDEX idx_audit_events_entity ON audit_events (entity_type, entity_id, created_at DESC);

CREATE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

-- Защита от повторной отправки формы: один ключ — один результат.
CREATE TABLE idempotency_keys (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key VARCHAR(100) NOT NULL,
  scope VARCHAR(50) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  status_code INT,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, scope, key)
);
