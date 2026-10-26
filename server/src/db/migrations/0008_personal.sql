-- Личное пространство и аккаунт: сеансы, личные заметки (ежедневник) и их
-- отправка в чат, свои имена для коллег, вход на сайт по QR-коду с телефона,
-- кто и с какими данными прислал уведомление.

-- Версия токенов: смена или сброс пароля, отключение сотрудника и «выйти на
-- всех устройствах» увеличивают её — все выданные раньше токены перестают
-- работать сразу, а не через 30 дней.
ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;

-- Личные заметки — отдельно от общей «Базы знаний» (notes): их видит только
-- владелец. День календаря, «Избранное», файлы — во вложениях (owner_type 'note').
CREATE TABLE personal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  title VARCHAR(200) NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 50000),
  note_date DATE NOT NULL,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, company_id),
  FOREIGN KEY (company_id, owner_id) REFERENCES company_members(company_id, user_id) ON DELETE CASCADE
);
CREATE INDEX idx_personal_notes_owner_date ON personal_notes (owner_id, note_date);
CREATE INDEX idx_personal_notes_owner_updated ON personal_notes (owner_id, updated_at DESC);
CREATE INDEX idx_personal_notes_favorite ON personal_notes (owner_id) WHERE is_favorite;

-- Снимок заметки, отправленной в чат: получатель видит именно то, что ему
-- отправили, даже если автор потом изменит или удалит оригинал. Файлы снимка —
-- копии записей вложений (owner_type 'note_share'), сами файлы на диске общие.
CREATE TABLE note_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  note_id UUID REFERENCES personal_notes(id) ON DELETE SET NULL,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(200) NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 50000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_note_shares_note ON note_shares (note_id) WHERE note_id IS NOT NULL;

-- Кто сохранил пересланную заметку себе — и в какую свою заметку.
CREATE TABLE note_share_acceptances (
  share_id UUID NOT NULL REFERENCES note_shares(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id UUID REFERENCES personal_notes(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (share_id, user_id)
);

-- Запрос свежей версии: автор подтверждает — запросившему приходит новая
-- копия («План (2)»), снимок в чате не меняется.
CREATE TABLE note_share_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  share_id UUID NOT NULL REFERENCES note_shares(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id UUID REFERENCES personal_notes(id) ON DELETE SET NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  result_note_id UUID REFERENCES personal_notes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CHECK (requester_id <> owner_id)
);
-- Один открытый запрос на одну пересланную заметку от одного человека.
CREATE UNIQUE INDEX uq_note_share_requests_pending ON note_share_requests (share_id, requester_id) WHERE status = 'pending';
CREATE INDEX idx_note_share_requests_owner ON note_share_requests (owner_id, status);

-- Заметка как сообщение чата.
ALTER TABLE messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'service', 'poll', 'media', 'voice', 'video_note', 'contact', 'note'));
ALTER TABLE messages ADD COLUMN note_share_id UUID REFERENCES note_shares(id) ON DELETE SET NULL;
CREATE INDEX idx_messages_note_share ON messages (note_share_id) WHERE note_share_id IS NOT NULL;

-- Файлы личных заметок и снимков.
ALTER TABLE attachments DROP CONSTRAINT attachments_owner_type_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_owner_type_check CHECK (owner_type IN ('message', 'task', 'comment', 'note', 'note_share'));

-- «Изменить контакт», как в Telegram: своё имя для коллеги, видно только мне.
-- В профиле сотрудника по-прежнему его настоящее имя.
CREATE TABLE contact_names (
  company_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  user_id UUID NOT NULL,
  name VARCHAR(120) NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, user_id),
  FOREIGN KEY (company_id, owner_id) REFERENCES company_members(company_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, user_id) REFERENCES company_members(company_id, user_id) ON DELETE CASCADE,
  CHECK (owner_id <> user_id)
);

-- Вход на сайт по QR-коду с телефона, как в Telegram Web: сайт показывает
-- код, приложение (где человек уже вошёл) сканирует и подтверждает вход.
-- token — в QR-коде, его может увидеть кто угодно рядом с экраном; secret —
-- только у браузера, который показал код: без него сессию не забрать.
-- В базе — только хеши. Забрать вход можно один раз.
CREATE TABLE qr_logins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash CHAR(64) NOT NULL UNIQUE,
  secret_hash CHAR(64) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scanned', 'approved', 'declined', 'used')),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_agent VARCHAR(500),
  ip VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (status = 'pending' OR user_id IS NOT NULL)
);
CREATE INDEX idx_qr_logins_expires ON qr_logins (expires_at);

-- Уведомление знает, от кого оно, и несёт данные для перехода: запрос
-- заметки, просьба, контрольная точка.
ALTER TABLE notifications ADD COLUMN actor_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN data JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX idx_notifications_unread ON notifications (user_id, company_id) WHERE read_at IS NULL;
