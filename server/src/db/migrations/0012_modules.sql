-- Функции компании: какие крупные разделы выключены. Храним выключенные,
-- а не включённые: раздел, который появится позже, у всех сразу включён.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS disabled_modules TEXT[] NOT NULL DEFAULT '{}';
