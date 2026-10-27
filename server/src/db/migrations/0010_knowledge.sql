-- 0010: база знаний с ИИ — документы, фрагменты с векторами, диалоги с ассистентом.

-- Документ базы знаний: PDF, DOCX или текст. Сам файл — во вложениях (owner_type 'kb_doc'),
-- здесь — что из него извлекли. goal_id — документ к цели (видят те, кто видит цель),
-- NULL — для всей компании.
CREATE TABLE knowledge_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  goal_id UUID REFERENCES goals(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  doc_type VARCHAR(10) NOT NULL CHECK (doc_type IN ('pdf', 'docx', 'text')),
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error VARCHAR(500),
  chars INTEGER NOT NULL DEFAULT 0,
  pages INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX idx_knowledge_docs_company ON knowledge_docs (company_id, created_at DESC);
CREATE INDEX idx_knowledge_docs_queue ON knowledge_docs (created_at) WHERE status IN ('pending', 'processing');

ALTER TABLE attachments DROP CONSTRAINT attachments_owner_type_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_owner_type_check CHECK (owner_type IN ('message', 'task', 'comment', 'note', 'note_share', 'kb_doc'));

-- Фрагменты для поиска: из статьи (note_id) или документа (doc_id). Вектор — массив чисел:
-- так работает и на обычном PostgreSQL, и в тестах; с pgvector сравнение идёт в базе.
-- model — чем посчитан вектор: сменили модель — фрагменты пересчитываются.
CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
  doc_id UUID REFERENCES knowledge_docs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding REAL[] NOT NULL,
  model VARCHAR(120) NOT NULL,
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((note_id IS NULL) <> (doc_id IS NULL))
);
CREATE INDEX idx_knowledge_chunks_company ON knowledge_chunks (company_id, model);
CREATE UNIQUE INDEX idx_knowledge_chunks_note ON knowledge_chunks (note_id, idx) WHERE note_id IS NOT NULL;
CREATE UNIQUE INDEX idx_knowledge_chunks_doc ON knowledge_chunks (doc_id, idx) WHERE doc_id IS NOT NULL;

-- Диалоги с ассистентом: свои у каждого сотрудника.
CREATE TABLE knowledge_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_knowledge_sessions_user ON knowledge_sessions (user_id, updated_at DESC);

CREATE TABLE knowledge_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES knowledge_sessions(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (char_length(content) <= 20000),
  sources JSONB NOT NULL DEFAULT '[]',
  mode VARCHAR(10) CHECK (mode IN ('ai', 'extract', 'empty')),
  notice VARCHAR(300),
  feedback VARCHAR(4) CHECK (feedback IN ('up', 'down')),
  feedback_comment VARCHAR(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_knowledge_messages_session ON knowledge_messages (session_id, created_at);

-- pgvector — если расширение есть на сервере; нет — поиск считает близость сам.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector недоступен, поиск по базе знаний считает близость в приложении';
END $$;
