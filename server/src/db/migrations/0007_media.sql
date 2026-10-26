-- Файлы и медиа: одна таблица вложений для сообщений, задач и комментариев,
-- голосовые и кружочки с отметкой «прослушано», карточка контакта в чате.
-- Сам файл лежит на диске сервера (UPLOADS_DIR), в базе — только описание.

-- Сначала вложение загружается «черновиком» (без владельца), затем
-- прикрепляется к сообщению, задаче или комментарию. Черновики старше суток
-- убирает фоновая задача. Один и тот же файл на диске может быть у
-- нескольких записей (пересылка) — удаляется, когда ссылок не осталось.
CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_type VARCHAR(10) CHECK (owner_type IN ('message', 'task', 'comment')),
  owner_id UUID,
  position SMALLINT NOT NULL DEFAULT 0,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('photo', 'video', 'file', 'voice', 'video_note')),
  name VARCHAR(255) NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  mime VARCHAR(127) NOT NULL,
  size BIGINT NOT NULL CHECK (size >= 0),
  -- Путь внутри UPLOADS_DIR: files/ab/<32 hex>.<ext>.
  storage_key VARCHAR(200) NOT NULL CHECK (storage_key ~ '^files/[0-9a-f]{2}/[0-9a-f]{32}(\.[a-z0-9]{1,10})?$'),
  thumb_key VARCHAR(200) CHECK (thumb_key IS NULL OR thumb_key ~ '^thumbs/[0-9a-f]{32}\.jpg$'),
  width INT CHECK (width IS NULL OR width > 0),
  height INT CHECK (height IS NULL OR height > 0),
  duration REAL CHECK (duration IS NULL OR duration >= 0),
  waveform VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, company_id),
  CHECK ((owner_type IS NULL) = (owner_id IS NULL))
);
CREATE INDEX idx_attachments_owner ON attachments (owner_type, owner_id, position) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_attachments_drafts ON attachments (created_at) WHERE owner_id IS NULL;
CREATE INDEX idx_attachments_storage ON attachments (storage_key);

-- Новые виды сообщений: медиа (фото, видео, файлы — альбом до 10), голосовое,
-- кружочек и карточка контакта.
ALTER TABLE messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'service', 'poll', 'media', 'voice', 'video_note', 'contact'));
ALTER TABLE messages ADD COLUMN contact_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Кто прослушал голосовое или посмотрел кружочек.
CREATE TABLE message_listens (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

-- Комментарий может состоять только из файлов: текст проверяет приложение.
ALTER TABLE comments DROP CONSTRAINT comments_body_check;
ALTER TABLE comments ADD CONSTRAINT comments_body_check CHECK (char_length(body) <= 4000);
