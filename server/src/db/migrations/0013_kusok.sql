-- Оригиналы вложений в хранилище kusok (дедупликация): ключ kusok:<SHA-256>.
-- Старые ключи files/... остаются в силе и переезжают в kusok фоном.
ALTER TABLE attachments DROP CONSTRAINT attachments_storage_key_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_storage_key_check
  CHECK (storage_key ~ '^(files/[0-9a-f]{2}/[0-9a-f]{32}(\.[a-z0-9]{1,10})?|kusok:[0-9a-f]{64})$');
