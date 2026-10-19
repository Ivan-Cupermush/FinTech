-- Обсуждение цели и задачи: ответы, упоминания и отметка «прочитано».
-- Комментарии уже лежат в comments; добавляем ветку и упоминания.
ALTER TABLE comments ADD COLUMN parent_id UUID REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE comments ADD COLUMN mention_ids UUID[] NOT NULL DEFAULT '{}';
CREATE INDEX idx_comments_parent ON comments (parent_id) WHERE parent_id IS NOT NULL;

-- До какого момента человек прочитал обсуждение: счётчик «новых» — всё, что позже.
CREATE TABLE comment_reads (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('goal', 'task')),
  entity_id UUID NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, entity_type, entity_id)
);

-- Заметки и база знаний: страница к цели (goal_id) или для всей компании (NULL).
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  goal_id UUID REFERENCES goals(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 50000),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notes_company ON notes (company_id, updated_at DESC);
CREATE INDEX idx_notes_goal ON notes (goal_id) WHERE goal_id IS NOT NULL;
