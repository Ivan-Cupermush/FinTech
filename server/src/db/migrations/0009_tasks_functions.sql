-- 0009: просьбы, контрольные точки, архив и наблюдатели задач; функции, которые руководитель передаёт сотруднику.

-- Просьба — та же задача без приёмки: исполнитель сам отмечает «Готово», автор благодарит.
ALTER TABLE tasks ADD COLUMN kind VARCHAR(10) NOT NULL DEFAULT 'task' CHECK (kind IN ('task', 'request'));
ALTER TABLE tasks ADD COLUMN thanked_at TIMESTAMPTZ;

-- Архив: закрытая задача уходит туда сама через 3 дня или руками. closed_at — когда
-- задачу выполнили или отменили; unarchived_at — когда вернули: после этого сама в
-- архив не уходит, пока её не закроют снова.
ALTER TABLE tasks ADD COLUMN closed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN archived_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN unarchived_at TIMESTAMPTZ;
UPDATE tasks SET closed_at = COALESCE(done_at, updated_at) WHERE status IN ('done', 'cancelled');
CREATE INDEX idx_tasks_closed_live ON tasks (company_id, closed_at) WHERE archived_at IS NULL AND closed_at IS NOT NULL;

-- Наблюдатель — рядом с согласующим: видит задачу и её события, отмечает точки, но не принимает работу.
ALTER TABLE task_participants DROP CONSTRAINT task_participants_role_check;
ALTER TABLE task_participants ADD CONSTRAINT task_participants_role_check CHECK (role IN ('owner', 'executor', 'approver', 'watcher', 'contributor'));

-- Контрольные точки: промежуточные сроки внутри задачи.
CREATE TABLE task_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  due_at DATE NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'missed')),
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_task_checkpoints_task ON task_checkpoints (task_id, due_at);

-- Функции сотрудника: allowed = TRUE — включено явно, FALSE — отключено явно,
-- строки нет — по должности. granted_by решает, где функция действует.
CREATE TABLE user_functions (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fn VARCHAR(40) NOT NULL CHECK (fn IN ('kpi_record', 'kpi_assign', 'knowledge_manage')),
  allowed BOOLEAN NOT NULL,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, user_id, fn)
);
