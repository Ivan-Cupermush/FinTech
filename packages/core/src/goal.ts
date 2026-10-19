import { validateMetric, type FieldErrors, type MetricInput } from './kpi';

export const GOAL_TYPES = ['strategic', 'operational', 'personal'] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  strategic: 'Стратегическая',
  operational: 'Операционная',
  personal: 'Индивидуальная',
};

export const GOAL_TYPE_HINTS: Record<GoalType, string> = {
  strategic: 'Результат для всей организации на год или квартал',
  operational: 'Улучшение конкретного процесса: быстрее, точнее, дешевле',
  personal: 'Цель сотрудника: развитие, навык, личный показатель',
};

export const GOAL_STATUSES = ['draft', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  draft: 'Черновик',
  active: 'В работе',
  on_hold: 'На паузе',
  completed: 'Завершена',
  cancelled: 'Отменена',
};

/** Допустимые переходы статуса. Всё, чего нет в таблице, — 409 Conflict. */
export const GOAL_TRANSITIONS: Record<GoalStatus, readonly GoalStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active', 'cancelled'],
  completed: ['active'],
  cancelled: [],
};

export function canTransition(from: GoalStatus, to: GoalStatus): boolean {
  return GOAL_TRANSITIONS[from].includes(to);
}

export const LIMITS = {
  title: 200,
  description: 5000,
  metricName: 100,
} as const;

export interface GoalDraftInput {
  title?: unknown;
  description?: unknown;
  type?: unknown;
  owner_id?: unknown;
  due_at?: unknown;
  parent_goal_id?: unknown;
  metrics?: unknown;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Сегодняшняя дата YYYY-MM-DD в UTC (сервер и клиент считают одинаково). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Проверка цели. mode = 'draft' — проверяем только то, что заполнено
 * (черновик можно сохранить неполным); mode = 'active' — полная проверка:
 * без владельца, срока и измеримого KPI цель не запускается.
 */
export function validateGoal(input: GoalDraftInput, mode: 'draft' | 'active', today: string = todayIso()): FieldErrors {
  const errors: FieldErrors = {};
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) errors.title = 'Введите название цели';
  else if (title.length > LIMITS.title) errors.title = `Название — не длиннее ${LIMITS.title} символов`;

  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== 'string') errors.description = 'Описание должно быть текстом';
    else if (input.description.length > LIMITS.description) errors.description = 'Описание слишком длинное';
  }

  if (input.type === undefined || input.type === null || input.type === '') {
    errors.type = 'Выберите тип цели';
  } else if (!(GOAL_TYPES as readonly unknown[]).includes(input.type)) {
    errors.type = 'Неизвестный тип цели';
  }

  const hasOwner = typeof input.owner_id === 'string' && input.owner_id.length > 0;
  if (mode === 'active' && !hasOwner) errors.owner_id = 'Назначьте владельца цели';

  if (input.due_at !== undefined && input.due_at !== null && input.due_at !== '') {
    if (!isValidIsoDate(input.due_at)) errors.due_at = 'Укажите дату в формате ГГГГ-ММ-ДД';
    else if (input.due_at < today) errors.due_at = 'Срок должен быть не раньше текущей даты';
  } else if (mode === 'active') {
    errors.due_at = 'Укажите срок достижения результата';
  }

  const metrics = Array.isArray(input.metrics) ? input.metrics : [];
  if (input.metrics !== undefined && !Array.isArray(input.metrics)) errors.metrics = 'Некорректный список KPI';
  if (mode === 'active' && metrics.length === 0) {
    errors.metrics = 'Добавьте хотя бы один измеримый KPI — без него цель остаётся черновиком';
  }
  metrics.forEach((m, i) => {
    const e = validateMetric((m ?? {}) as Partial<Record<keyof MetricInput, unknown>>);
    for (const [k, v] of Object.entries(e)) errors[`metrics.${i}.${k}`] = v;
  });
  return errors;
}

export interface ReadinessItem {
  key: 'title' | 'type' | 'owner' | 'due' | 'kpi';
  label: string;
  done: boolean;
}

/** Чек-лист «Что осталось, чтобы запустить цель» — показываем у черновика. */
export function activationChecklist(goal: {
  title?: string | null;
  type?: string | null;
  owner_id?: string | null;
  due_at?: string | null;
  metrics?: readonly unknown[] | null;
}): ReadinessItem[] {
  return [
    { key: 'title', label: 'Название результата', done: !!goal.title?.trim() },
    { key: 'type', label: 'Тип цели', done: !!goal.type },
    { key: 'owner', label: 'Владелец цели', done: !!goal.owner_id },
    { key: 'due', label: 'Срок достижения', done: !!goal.due_at },
    { key: 'kpi', label: 'Измеримый KPI', done: (goal.metrics?.length ?? 0) > 0 },
  ];
}

/**
 * Подсказка к названию: цель описывает изменение, а не действие.
 * «Провести анализ процессов» — это задача; «Сократить время согласования» — цель.
 */
const ACTION_VERBS = /^(провести|сделать|написать|подготовить|организовать|разработать|создать|собрать|запустить|внедрить|настроить|обсудить|проверить)(?=\s|$)/i;
export function titleHint(title: string): string | null {
  if (ACTION_VERBS.test(title.trim())) {
    return 'Похоже на задачу. Опишите результат: что изменится — «Сократить…», «Увеличить…», «Снизить…»';
  }
  return null;
}
