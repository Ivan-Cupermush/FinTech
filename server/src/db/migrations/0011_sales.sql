-- 0011: продажи и личный KPI сотрудника с выплатами — модуль из прошлого проекта.
-- План сотрудника на месяц из показателей с правилами факта и выплаты; продажи,
-- записанные вручную или из Excel; отчёты 1С «Валовая прибыль» по менеджерам;
-- списки клиентов; сопоставление имён из 1С с сотрудниками; связь с KPI целей.

-- Функции продаж, как в прошлом проекте: загружать отчёты 1С, загружать файлы KPI, ставить план.
ALTER TABLE user_functions DROP CONSTRAINT user_functions_fn_check;
ALTER TABLE user_functions ADD CONSTRAINT user_functions_fn_check
  CHECK (fn IN ('kpi_record', 'kpi_assign', 'knowledge_manage', 'sales_reports', 'sales_files', 'sales_assign'));

-- Показатель плана сотрудника на месяц. source = file — из файла KPI (факт и «к выплате»
-- берутся из файла), manual — поставлен в offix (факт вручную или по отчётам 1С).
CREATE TABLE sales_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL,
  month DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  name VARCHAR(300) NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 300),
  kind VARCHAR(20) CHECK (kind IN ('non_key', 'key', 'clients', 'distribution', 'brand', 'salary', 'fuel', 'fixed', 'other')),
  unit VARCHAR(10) NOT NULL CHECK (unit IN ('rub', 'count', 'clients', 'items', 'percent')),
  plan NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (plan >= 0),
  fact NUMERIC(18, 2) NOT NULL DEFAULT 0,
  bonus NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (bonus >= 0),
  -- «К выплате» из итогового файла KPI.
  payment NUMERIC(18, 2),
  file_percent NUMERIC(10, 1),
  fact_rule JSONB NOT NULL,
  payout_rule JSONB NOT NULL,
  -- Руководитель поправил правило: повторная загрузка файла KPI его не сбросит.
  rules_custom BOOLEAN NOT NULL DEFAULT FALSE,
  fact_details JSONB,
  file_items JSONB,
  source VARCHAR(10) NOT NULL CHECK (source IN ('manual', 'file')),
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  fact_updated_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, user_id) REFERENCES company_members(company_id, user_id) ON DELETE CASCADE
);
CREATE INDEX idx_sales_plans_user_month ON sales_plans (company_id, user_id, month, sort_order);

-- Загрузка продаж из Excel: строки ждут, пока человек выберет колонки.
CREATE TABLE sales_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  headers JSONB NOT NULL,
  rows JSONB,
  lines JSONB,
  total_rows INT NOT NULL DEFAULT 0,
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled')),
  imported INT NOT NULL DEFAULT 0,
  skipped INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  FOREIGN KEY (company_id, user_id) REFERENCES company_members(company_id, user_id) ON DELETE CASCADE
);
CREATE INDEX idx_sales_imports_user ON sales_imports (company_id, user_id, created_at DESC);

-- Продажа, записанная вручную или строкой из Excel.
CREATE TABLE sales_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL,
  plan_id UUID REFERENCES sales_plans(id) ON DELETE SET NULL,
  import_id UUID REFERENCES sales_imports(id) ON DELETE SET NULL,
  product VARCHAR(255) NOT NULL CHECK (char_length(trim(product)) BETWEEN 1 AND 255),
  client VARCHAR(255),
  quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
  amount NUMERIC(18, 2) NOT NULL CHECK (amount >= 0),
  sold_on DATE NOT NULL,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (company_id, user_id) REFERENCES company_members(company_id, user_id) ON DELETE CASCADE
);
CREATE INDEX idx_sales_entries_user_day ON sales_entries (company_id, user_id, sold_on DESC);

-- Отчёт 1С о продажах за период внутри одного месяца.
CREATE TABLE sales_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  month DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  total NUMERIC(18, 2) NOT NULL DEFAULT 0,
  file_total NUMERIC(18, 2),
  warnings JSONB NOT NULL DEFAULT '[]',
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start)
);
CREATE INDEX idx_sales_reports_month ON sales_reports (company_id, month);

-- Строки отчёта по менеджеру: итог по клиенту (total), группы товаров и товары.
-- Менеджер, которого не нашли среди сотрудников, хранится с user_id = NULL
-- до ручного сопоставления.
CREATE TABLE sales_report_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES sales_reports(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  manager_name VARCHAR(255) NOT NULL,
  manager_key VARCHAR(255) NOT NULL,
  client_name VARCHAR(500) NOT NULL,
  kind VARCHAR(5) NOT NULL CHECK (kind IN ('total', 'group', 'item')),
  depth SMALLINT NOT NULL DEFAULT 0,
  group_path TEXT NOT NULL DEFAULT '',
  name VARCHAR(500) NOT NULL,
  quantity NUMERIC(18, 3) NOT NULL DEFAULT 0,
  revenue NUMERIC(18, 2) NOT NULL DEFAULT 0
);
CREATE INDEX idx_sales_report_lines_report ON sales_report_lines (report_id);
CREATE INDEX idx_sales_report_lines_user ON sales_report_lines (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_sales_report_lines_manager ON sales_report_lines (manager_key) WHERE user_id IS NULL;

-- Списки клиентов: key — ключевые клиенты (сеть), merge — задвоенные: все с таким
-- названием считаются одной точкой.
CREATE TABLE sales_client_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind VARCHAR(5) NOT NULL CHECK (kind IN ('key', 'merge')),
  pattern VARCHAR(200) NOT NULL CHECK (char_length(trim(pattern)) BETWEEN 2 AND 200),
  pattern_key VARCHAR(200) NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, kind, pattern_key)
);

-- «Этот менеджер из 1С — вот этот сотрудник».
CREATE TABLE sales_name_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  name_key VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  user_id UUID NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name_key),
  FOREIGN KEY (company_id, user_id) REFERENCES company_members(company_id, user_id) ON DELETE CASCADE
);

-- KPI цели, который заполняется продажами: выручка, штуки или клиенты за месяц —
-- всей компании или подразделения (с вложенными). Один замер на месяц, последним днём.
CREATE TABLE sales_goal_links (
  metric_id UUID PRIMARY KEY REFERENCES goal_metrics(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  measure VARCHAR(10) NOT NULL CHECK (measure IN ('revenue', 'quantity', 'clients')),
  unit_id UUID REFERENCES org_units(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Какие замеры записали продажи: при новом отчёте за месяц замер обновляется, а не задваивается.
CREATE TABLE sales_goal_months (
  metric_id UUID NOT NULL REFERENCES sales_goal_links(metric_id) ON DELETE CASCADE,
  month DATE NOT NULL,
  observation_id UUID NOT NULL REFERENCES goal_metric_observations(id) ON DELETE CASCADE,
  value NUMERIC(18, 4) NOT NULL,
  PRIMARY KEY (metric_id, month)
);
