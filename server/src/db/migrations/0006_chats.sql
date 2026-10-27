-- Мессенджер: личные чаты, группы и группы с темами, сообщения, реакции,
-- опросы и отложенная отправка. Все таблицы привязаны к компании: в чате
-- могут быть только её сотрудники (составные ключи с company_members).

-- Когда человек был в сети и фото профиля (загрузка фото — следующим шагом).
ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN avatar_url TEXT;

CREATE TABLE chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL CHECK (type IN ('private', 'group')),
  name VARCHAR(80) CHECK (name IS NULL OR char_length(trim(name)) BETWEEN 1 AND 80),
  -- Группа с темами: сообщения живут в темах, у каждой — своё «прочитано».
  is_supergroup BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Личный чат один на пару: «меньший:больший» UUID, с собой — «id:id».
  direct_key VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, company_id),
  UNIQUE (company_id, direct_key),
  CHECK ((type = 'private') = (direct_key IS NOT NULL)),
  CHECK (type = 'group' OR NOT is_supergroup)
);

CREATE TABLE chat_members (
  chat_id UUID NOT NULL,
  company_id UUID NOT NULL,
  user_id UUID NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- До какого номера сообщения прочитано; в группе с темами — номер на момент
  -- вступления, а прочитанное по темам лежит в topic_reads.
  last_read_seq BIGINT NOT NULL DEFAULT 0,
  pinned_at TIMESTAMPTZ,
  muted_until TIMESTAMPTZ,
  -- Скрыт из списка до следующего сообщения.
  hidden_at TIMESTAMPTZ,
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY (chat_id, company_id) REFERENCES chats(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, user_id) REFERENCES company_members(company_id, user_id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_members_user ON chat_members (user_id, company_id);

CREATE TABLE chat_admins (
  chat_id UUID NOT NULL,
  user_id UUID NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY (chat_id, user_id) REFERENCES chat_members(chat_id, user_id) ON DELETE CASCADE
);

CREATE TABLE topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL,
  company_id UUID NOT NULL,
  name VARCHAR(60) NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 60),
  icon VARCHAR(16) NOT NULL DEFAULT '💬',
  color VARCHAR(7) NOT NULL DEFAULT '#2f4bff' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  -- Общая тема появляется при включении тем; её нельзя удалить.
  is_general BOOLEAN NOT NULL DEFAULT FALSE,
  closed BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (chat_id, company_id) REFERENCES chats(id, company_id) ON DELETE CASCADE
);
CREATE INDEX idx_topics_chat ON topics (chat_id);

CREATE TABLE topic_reads (
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_seq BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (topic_id, user_id)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL,
  company_id UUID NOT NULL,
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
  -- Сквозной порядковый номер: курсор истории и «прочитано до».
  seq BIGSERIAL NOT NULL UNIQUE,
  -- text, service, poll; файлы, голосовые и медиа — следующим шагом.
  kind VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'service', 'poll')),
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  text TEXT CHECK (text IS NULL OR char_length(text) <= 4000),
  reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  -- Ответ на сообщение из другого чата.
  external_reply_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  -- Пересланное: снимок автора и чата, исходник может исчезнуть.
  forwarded_from_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  forward_sender_name VARCHAR(200),
  forward_chat_title VARCHAR(200),
  edited_at TIMESTAMPTZ,
  deleted_for_all BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_for UUID[] NOT NULL DEFAULT '{}',
  pinned_at TIMESTAMPTZ,
  pinned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Повторная отправка того же сообщения (сеть моргнула) не создаёт дубль.
  client_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (chat_id, company_id) REFERENCES chats(id, company_id) ON DELETE CASCADE
);
CREATE INDEX idx_messages_chat_seq ON messages (chat_id, seq DESC);
CREATE INDEX idx_messages_topic_seq ON messages (topic_id, seq DESC) WHERE topic_id IS NOT NULL;
CREATE INDEX idx_messages_pinned ON messages (chat_id) WHERE pinned_at IS NOT NULL;
CREATE UNIQUE INDEX uq_messages_client ON messages (sender_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE message_reactions (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Одна реакция от человека.
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE scheduled_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL,
  company_id UUID NOT NULL,
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4000),
  reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  send_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (chat_id, company_id) REFERENCES chats(id, company_id) ON DELETE CASCADE
);
CREATE INDEX idx_scheduled_due ON scheduled_messages (send_at);

CREATE TABLE polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  question VARCHAR(255) NOT NULL,
  anonymous BOOLEAN NOT NULL DEFAULT TRUE,
  multiple BOOLEAN NOT NULL DEFAULT FALSE,
  quiz BOOLEAN NOT NULL DEFAULT FALSE,
  explanation VARCHAR(200),
  closed_at TIMESTAMPTZ
);

CREATE TABLE poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  position INT NOT NULL,
  text VARCHAR(100) NOT NULL,
  correct BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (poll_id, position)
);

CREATE TABLE poll_votes (
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (option_id, user_id)
);
CREATE INDEX idx_poll_votes_poll ON poll_votes (poll_id, user_id);
