import { addDays, diffDays } from './dates';
import type { GoalType } from './goal';
import type { Direction } from './kpi';
import { plural, type UnitId } from './units';

/**
 * Шаблоны целей для вузов. Руководитель выбирает типовой результат —
 * «Сократить время обработки заявки студента» — и за минуту получает
 * черновик с измеримым KPI, подцелями и планом задач с зависимостями.
 * Остаётся подставить владельца, срок и свои цифры «было → цель».
 * Шаблон — это результат, а не список работ: название проходит titleHint.
 */

export const TEMPLATE_AREAS = ['students', 'documents', 'people', 'it', 'campus', 'quality'] as const;
export type TemplateArea = (typeof TEMPLATE_AREAS)[number];

export const TEMPLATE_AREA_LABELS: Record<TemplateArea, string> = {
  students: 'Студенты и приём',
  documents: 'Документы и договоры',
  people: 'Сотрудники',
  it: 'IT и цифровые сервисы',
  campus: 'Кампус',
  quality: 'Качество сервиса',
};

export interface TemplateKpi {
  name: string;
  unit: UnitId;
  direction: Exclude<Direction, 'maintain'>;
  /** Типичные значения для вуза — человек заменит их своими. */
  baseline: number;
  target: number;
  /** Как измерить исходное значение. */
  hint: string;
  /** Откуда брать цифру дальше. */
  source: string;
}

export interface TemplateTask {
  key: string;
  title: string;
  /** Подцель, к которой относится задача; без неё — к самой цели. */
  subgoal?: string;
  /** День от старта, когда задача начинается. */
  start: number;
  /** Сколько дней на задачу. */
  days: number;
  /** Задачи, которые должны закончиться раньше. */
  after?: string[];
  done: string;
}

export interface GoalTemplate {
  key: string;
  area: TemplateArea;
  title: string;
  type: GoalType;
  description: string;
  kpi: TemplateKpi;
  subgoals: { key: string; title: string }[];
  tasks: TemplateTask[];
  /** Рекомендуемый срок от старта, дней. */
  plan_days: number;
}

export const GOAL_TEMPLATES: readonly GoalTemplate[] = [
  {
    key: 'application-time',
    area: 'students',
    title: 'Сократить время обработки заявки студента',
    type: 'operational',
    description: 'Студент получает ответ на заявку быстрее, без потери качества и без нарушения контрольных процедур.',
    kpi: {
      name: 'Среднее время обработки заявки',
      unit: 'minutes',
      direction: 'decrease',
      baseline: 40,
      target: 30,
      hint: 'Замерьте 20–30 заявок за неделю: от поступления до ответа студенту',
      source: 'Журнал заявок или СЭД: время регистрации и время ответа',
    },
    subgoals: [
      { key: 'route', title: 'Убрать лишние согласования в маршруте заявки' },
      { key: 'form', title: 'Сократить ручной ввод данных в форме заявки' },
    ],
    tasks: [
      { key: 'map', title: 'Описать текущий путь заявки и замерить время этапов', subgoal: 'route', start: 0, days: 10, done: 'Схема этапов с временем каждого, видно узкое место' },
      { key: 'approve', title: 'Согласовать сокращённый маршрут с учебно-методическим управлением', subgoal: 'route', start: 10, days: 15, after: ['map'], done: 'Подписан новый порядок согласования' },
      { key: 'autofill', title: 'Настроить автозаполнение формы из личного кабинета', subgoal: 'form', start: 10, days: 30, after: ['map'], done: 'ФИО, группа и направление подставляются сами' },
      { key: 'answers', title: 'Подготовить шаблоны типовых ответов', subgoal: 'form', start: 10, days: 14, after: ['map'], done: 'Шаблоны на 10 самых частых заявок' },
      { key: 'train', title: 'Обучить сотрудников учебного офиса новому порядку', start: 40, days: 7, after: ['approve', 'autofill', 'answers'], done: 'Все сотрудники офиса прошли инструктаж' },
      { key: 'measure', title: 'Замерить время после изменений и сравнить с исходным', start: 47, days: 14, after: ['train'], done: 'Замер внесён в KPI цели' },
    ],
    plan_days: 90,
  },
  {
    key: 'contract-approval',
    area: 'documents',
    title: 'Сократить срок согласования договоров',
    type: 'operational',
    description: 'Договор с контрагентом проходит согласование быстрее: меньше кругов правок, у каждого согласующего — понятный срок.',
    kpi: {
      name: 'Средний срок согласования договора',
      unit: 'days',
      direction: 'decrease',
      baseline: 12,
      target: 8,
      hint: 'Возьмите договоры за последний квартал: от регистрации проекта до подписания',
      source: 'СЭД: дата регистрации и дата подписания договора',
    },
    subgoals: [
      { key: 'templates', title: 'Типовые договоры без юридической экспертизы' },
      { key: 'edo', title: 'Электронное согласование вместо бумажного' },
    ],
    tasks: [
      { key: 'audit', title: 'Разобрать 30 договоров: где и сколько они ждали', start: 0, days: 14, done: 'Список этапов с медианой ожидания' },
      { key: 'typical', title: 'Утвердить шаблоны трёх самых частых договоров', subgoal: 'templates', start: 14, days: 21, after: ['audit'], done: 'Шаблоны утверждены юридическим отделом' },
      { key: 'sla', title: 'Закрепить срок на каждом этапе согласования', subgoal: 'edo', start: 14, days: 14, after: ['audit'], done: 'Приказ о сроках согласования' },
      { key: 'route', title: 'Настроить маршрут согласования в СЭД', subgoal: 'edo', start: 28, days: 21, after: ['sla'], done: 'Договор согласуется в СЭД без бумаги' },
      { key: 'pilot', title: 'Провести пилот на договорах одного подразделения', start: 49, days: 21, after: ['typical', 'route'], done: 'Пилот завершён, замечания учтены' },
      { key: 'measure', title: 'Замерить срок согласования после пилота', start: 70, days: 14, after: ['pilot'], done: 'Замер внесён в KPI цели' },
    ],
    plan_days: 120,
  },
  {
    key: 'onboarding',
    area: 'people',
    title: 'Ускорить адаптацию новых сотрудников',
    type: 'operational',
    description: 'Новый сотрудник быстрее выходит на полную нагрузку: знает, к кому обратиться, и не теряет первые недели.',
    kpi: {
      name: 'Срок выхода на полную нагрузку',
      unit: 'days',
      direction: 'decrease',
      baseline: 60,
      target: 40,
      hint: 'Спросите руководителей последних 10 новичков: через сколько дней они работали самостоятельно',
      source: 'Опрос руководителя через 30, 60 и 90 дней после выхода',
    },
    subgoals: [
      { key: 'week', title: 'Единый план первой недели' },
      { key: 'mentor', title: 'Наставник у каждого новичка' },
    ],
    tasks: [
      { key: 'interview', title: 'Опросить сотрудников, пришедших за последний год', start: 0, days: 14, done: 'Список типовых трудностей первых недель' },
      { key: 'plan', title: 'Составить чек-лист первой недели для подразделений', subgoal: 'week', start: 14, days: 14, after: ['interview'], done: 'Чек-лист согласован с руководителями' },
      { key: 'access', title: 'Выдавать доступы и рабочее место до первого дня', subgoal: 'week', start: 14, days: 21, after: ['interview'], done: 'Заявка на доступы уходит при оформлении' },
      { key: 'mentors', title: 'Назначить наставников и описать их роль', subgoal: 'mentor', start: 14, days: 21, after: ['interview'], done: 'В каждом подразделении есть наставник' },
      { key: 'survey', title: 'Запустить опрос новичка и руководителя через 30 дней', start: 35, days: 7, after: ['plan', 'mentors'], done: 'Опрос уходит автоматически' },
    ],
    plan_days: 120,
  },
  {
    key: 'first-pass',
    area: 'quality',
    title: 'Увеличить долю заявок без возврата на доработку',
    type: 'operational',
    description: 'Заявки и документы с первого раза оформлены правильно: меньше кругов «вернули — исправили — отправили снова».',
    kpi: {
      name: 'Доля заявок без возврата',
      unit: 'percent',
      direction: 'increase',
      baseline: 70,
      target: 90,
      hint: 'Посчитайте, сколько заявок за месяц прошли без единого возврата',
      source: 'СЭД или журнал заявок: статус «возвращено на доработку»',
    },
    subgoals: [
      { key: 'reasons', title: 'Понятные требования к заявке до отправки' },
      { key: 'check', title: 'Проверка ошибок в форме, а не у согласующего' },
    ],
    tasks: [
      { key: 'causes', title: 'Собрать причины возвратов за последние три месяца', start: 0, days: 10, done: 'Топ-5 причин с долями' },
      { key: 'guide', title: 'Опубликовать памятку «Как заполнить заявку с первого раза»', subgoal: 'reasons', start: 10, days: 10, after: ['causes'], done: 'Памятка рядом с формой заявки' },
      { key: 'fields', title: 'Добавить обязательные поля и подсказки в форму', subgoal: 'check', start: 10, days: 21, after: ['causes'], done: 'Форма не отправляется с частыми ошибками' },
      { key: 'feedback', title: 'Ввести обязательную причину при возврате', subgoal: 'check', start: 10, days: 7, after: ['causes'], done: 'Каждый возврат с причиной из списка' },
      { key: 'measure', title: 'Пересчитать долю заявок без возврата', start: 45, days: 14, after: ['guide', 'fields', 'feedback'], done: 'Замер внесён в KPI цели' },
    ],
    plan_days: 90,
  },
  {
    key: 'student-nps',
    area: 'quality',
    title: 'Повысить NPS студентов по сервисам университета',
    type: 'strategic',
    description: 'Студенты чаще готовы рекомендовать сервисы университета: деканат, общежитие, библиотеку, цифровые сервисы.',
    kpi: {
      name: 'NPS студентов по сервисам',
      unit: 'points',
      direction: 'increase',
      baseline: 15,
      target: 35,
      hint: 'Короткий опрос «Насколько вероятно, что вы порекомендуете…» по шкале 0–10',
      source: 'Опрос студентов раз в семестр, NPS = % промоутеров − % критиков',
    },
    subgoals: [
      { key: 'listen', title: 'Регулярная обратная связь от студентов' },
      { key: 'fix', title: 'Устранены три главные причины недовольства' },
      { key: 'tell', title: 'Студенты знают об изменениях' },
    ],
    tasks: [
      { key: 'survey', title: 'Провести базовый опрос NPS по сервисам', subgoal: 'listen', start: 0, days: 21, done: 'Не меньше 300 ответов, NPS по каждому сервису' },
      { key: 'analyze', title: 'Разобрать комментарии критиков и выделить причины', subgoal: 'listen', start: 21, days: 14, after: ['survey'], done: 'Топ-3 причины с примерами' },
      { key: 'owners', title: 'Назначить ответственных за каждую причину', subgoal: 'fix', start: 35, days: 7, after: ['analyze'], done: 'У каждой причины есть владелец и план' },
      { key: 'quick', title: 'Внедрить быстрые улучшения по трём причинам', subgoal: 'fix', start: 42, days: 60, after: ['owners'], done: 'Улучшения работают, есть подтверждение' },
      { key: 'news', title: 'Рассказать студентам, что изменилось по их отзывам', subgoal: 'tell', start: 102, days: 14, after: ['quick'], done: 'Публикация в каналах студентов' },
      { key: 'resurvey', title: 'Повторить опрос NPS', subgoal: 'listen', start: 120, days: 21, after: ['news'], done: 'Замер внесён в KPI цели' },
    ],
    plan_days: 180,
  },
  {
    key: 'response-time',
    area: 'students',
    title: 'Сократить время ответа на обращения студентов',
    type: 'operational',
    description: 'Студент получает первый ответ на обращение в течение рабочего дня, а не через сутки и больше.',
    kpi: {
      name: 'Медианное время первого ответа',
      unit: 'hours',
      direction: 'decrease',
      baseline: 24,
      target: 8,
      hint: 'Возьмите обращения за две недели: от поступления до первого ответа',
      source: 'Почта, чат-бот или портал обращений: время поступления и ответа',
    },
    subgoals: [
      { key: 'channel', title: 'Одно окно для обращений' },
      { key: 'faq', title: 'Ответы на частые вопросы без участия сотрудника' },
    ],
    tasks: [
      { key: 'count', title: 'Посчитать обращения по каналам и темам', start: 0, days: 10, done: 'Сколько обращений, откуда и о чём' },
      { key: 'single', title: 'Свести обращения в одну очередь', subgoal: 'channel', start: 10, days: 21, after: ['count'], done: 'Почта и чат попадают в одну очередь' },
      { key: 'duty', title: 'Ввести дежурство по очереди обращений', subgoal: 'channel', start: 10, days: 7, after: ['count'], done: 'График дежурств утверждён' },
      { key: 'faq', title: 'Опубликовать ответы на 20 частых вопросов', subgoal: 'faq', start: 10, days: 21, after: ['count'], done: 'База ответов на портале и в чат-боте' },
      { key: 'measure', title: 'Замерить время первого ответа', start: 35, days: 14, after: ['single', 'duty', 'faq'], done: 'Замер внесён в KPI цели' },
    ],
    plan_days: 60,
  },
  {
    key: 'room-utilization',
    area: 'campus',
    title: 'Повысить загрузку аудиторного фонда',
    type: 'operational',
    description: 'Аудитории используются полнее: меньше пустых часов в расписании и меньше нехватки помещений в пиковое время.',
    kpi: {
      name: 'Загрузка аудиторий в учебное время',
      unit: 'percent',
      direction: 'increase',
      baseline: 55,
      target: 75,
      hint: 'Доля занятых пар от всех доступных пар в аудиториях за неделю',
      source: 'Система расписания: занятые и свободные пары по аудиториям',
    },
    subgoals: [
      { key: 'data', title: 'Достоверные данные о занятости аудиторий' },
      { key: 'schedule', title: 'Расписание с учётом вместимости и загрузки' },
    ],
    tasks: [
      { key: 'inventory', title: 'Сверить реестр аудиторий: вместимость и оборудование', subgoal: 'data', start: 0, days: 21, done: 'Реестр совпадает с фактом' },
      { key: 'audit', title: 'Выборочно проверить фактическую занятость пар', subgoal: 'data', start: 0, days: 14, done: 'Отчёт: расписание против факта' },
      { key: 'booking', title: 'Открыть бронирование свободных аудиторий', subgoal: 'schedule', start: 21, days: 21, after: ['inventory'], done: 'Свободную аудиторию можно забронировать онлайн' },
      { key: 'rules', title: 'Согласовать правила распределения аудиторий', subgoal: 'schedule', start: 21, days: 21, after: ['inventory', 'audit'], done: 'Правила утверждены учебным управлением' },
      { key: 'measure', title: 'Пересчитать загрузку в новом семестре', start: 60, days: 14, after: ['booking', 'rules'], done: 'Замер внесён в KPI цели' },
    ],
    plan_days: 150,
  },
  {
    key: 'it-tickets',
    area: 'it',
    title: 'Сократить срок закрытия заявок в IT',
    type: 'operational',
    description: 'Сотрудники и преподаватели быстрее получают решение IT-проблем: доступы, оборудование, сбои.',
    kpi: {
      name: 'Средний срок закрытия заявки',
      unit: 'hours',
      direction: 'decrease',
      baseline: 48,
      target: 16,
      hint: 'Заявки за последний месяц: от создания до закрытия, без отложенных',
      source: 'Система заявок IT (Service Desk): время создания и закрытия',
    },
    subgoals: [
      { key: 'triage', title: 'Заявка сразу попадает к нужному специалисту' },
      { key: 'self', title: 'Типовые проблемы решаются без заявки' },
    ],
    tasks: [
      { key: 'categories', title: 'Разобрать заявки по категориям и срокам', start: 0, days: 10, done: 'Категории с медианой срока' },
      { key: 'routing', title: 'Настроить автоматическую маршрутизацию по категориям', subgoal: 'triage', start: 10, days: 21, after: ['categories'], done: 'Заявка назначается без диспетчера' },
      { key: 'sla', title: 'Ввести сроки реакции по приоритетам', subgoal: 'triage', start: 10, days: 10, after: ['categories'], done: 'Сроки видны в каждой заявке' },
      { key: 'reset', title: 'Запустить самостоятельный сброс пароля', subgoal: 'self', start: 10, days: 30, after: ['categories'], done: 'Пароль сбрасывается без звонка в IT' },
      { key: 'kb', title: 'Опубликовать инструкции по 15 частым проблемам', subgoal: 'self', start: 10, days: 21, after: ['categories'], done: 'Инструкции на портале' },
      { key: 'measure', title: 'Замерить срок закрытия заявок', start: 45, days: 14, after: ['routing', 'sla', 'reset', 'kb'], done: 'Замер внесён в KPI цели' },
    ],
    plan_days: 90,
  },
  {
    key: 'digital-services',
    area: 'it',
    title: 'Увеличить долю услуг, доступных онлайн',
    type: 'strategic',
    description: 'Студент и сотрудник получают справки, заявления и документы онлайн, без визита в офис.',
    kpi: {
      name: 'Доля услуг, доступных онлайн',
      unit: 'percent',
      direction: 'increase',
      baseline: 40,
      target: 80,
      hint: 'Составьте реестр услуг и отметьте, какие можно получить полностью онлайн',
      source: 'Реестр услуг университета, пересматривается раз в квартал',
    },
    subgoals: [
      { key: 'registry', title: 'Реестр услуг с владельцами' },
      { key: 'online', title: 'Самые востребованные услуги переведены в онлайн' },
      { key: 'adoption', title: 'Онлайн-услугами пользуются' },
    ],
    tasks: [
      { key: 'list', title: 'Составить реестр услуг для студентов и сотрудников', subgoal: 'registry', start: 0, days: 21, done: 'Реестр с владельцем и способом получения' },
      { key: 'rank', title: 'Выбрать 10 самых востребованных офлайн-услуг', subgoal: 'registry', start: 21, days: 7, after: ['list'], done: 'Список с числом обращений' },
      { key: 'rules', title: 'Убрать требование бумажного оригинала там, где можно', subgoal: 'online', start: 28, days: 30, after: ['rank'], done: 'Локальные акты обновлены' },
      { key: 'forms', title: 'Перевести выбранные услуги в личный кабинет', subgoal: 'online', start: 28, days: 90, after: ['rank'], done: 'Услуги доступны онлайн' },
      { key: 'promo', title: 'Рассказать об онлайн-услугах студентам и сотрудникам', subgoal: 'adoption', start: 118, days: 14, after: ['forms'], done: 'Рассылка и баннеры в кабинете' },
      { key: 'measure', title: 'Пересчитать долю онлайн-услуг по реестру', start: 132, days: 14, after: ['rules', 'promo'], done: 'Замер внесён в KPI цели' },
    ],
    plan_days: 180,
  },
  {
    key: 'certificates',
    area: 'students',
    title: 'Сократить срок выдачи справок студентам',
    type: 'operational',
    description: 'Справка об обучении, для военкомата или стипендии готова на следующий день, а не через несколько дней.',
    kpi: {
      name: 'Средний срок выдачи справки',
      unit: 'days',
      direction: 'decrease',
      baseline: 3,
      target: 1,
      hint: 'Журнал выдачи за месяц: от запроса до готовности справки',
      source: 'Журнал справок деканата или личный кабинет студента',
    },
    subgoals: [
      { key: 'request', title: 'Запрос справки онлайн' },
      { key: 'generate', title: 'Справка формируется из учётной системы' },
    ],
    tasks: [
      { key: 'types', title: 'Выбрать пять самых частых видов справок', start: 0, days: 7, done: 'Список с числом запросов' },
      { key: 'form', title: 'Открыть заказ справки в личном кабинете', subgoal: 'request', start: 7, days: 21, after: ['types'], done: 'Студент заказывает справку онлайн' },
      { key: 'templates', title: 'Настроить шаблоны справок с данными из учётной системы', subgoal: 'generate', start: 7, days: 28, after: ['types'], done: 'Справка собирается за минуту' },
      { key: 'sign', title: 'Согласовать электронную подпись справок', subgoal: 'generate', start: 7, days: 30, after: ['types'], done: 'Справку можно получить в электронном виде' },
      { key: 'measure', title: 'Замерить срок выдачи после запуска', start: 37, days: 14, after: ['form', 'templates', 'sign'], done: 'Замер внесён в KPI цели' },
    ],
    plan_days: 60,
  },
];

export function findTemplate(key: string): GoalTemplate | undefined {
  return GOAL_TEMPLATES.find((t) => t.key === key);
}

/** Срок по умолчанию: старт плюс рекомендуемая длительность шаблона. */
export function templateDueDate(t: Pick<GoalTemplate, 'plan_days'>, today: string): string {
  return addDays(today, t.plan_days);
}

/** Поиск по названию, описанию и KPI плюс фильтр по направлению. */
export function searchTemplates(list: readonly GoalTemplate[], query: string, area: TemplateArea | 'all' = 'all'): GoalTemplate[] {
  const words = query.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  return list.filter((t) => {
    if (area !== 'all' && t.area !== area) return false;
    const hay = `${t.title} ${t.description} ${t.kpi.name} ${TEMPLATE_AREA_LABELS[t.area]}`.toLowerCase().replace(/ё/g, 'е');
    return words.every((w) => hay.includes(w));
  });
}

export interface TemplateApplyInput {
  owner_id: string;
  due_at: string;
  /** Дата старта плана — обычно сегодня. */
  today: string;
  baseline?: number;
  target?: number;
}

export interface TemplatePlanTask {
  key: string;
  title: string;
  subgoal: string | null;
  start_at: string;
  due_at: string;
  depends_on: string[];
  definition_of_done: string;
}

export interface TemplatePlan {
  goal: {
    title: string;
    description: string;
    type: GoalType;
    owner_id: string;
    due_at: string;
    status: 'draft';
    metrics: { name: string; unit: UnitId; baseline: number; target: number; direction: Direction }[];
  };
  subgoals: { key: string; title: string }[];
  tasks: TemplatePlanTask[];
}

/**
 * Шаблон → черновик цели с планом. Сроки задач считаются от старта; если
 * выбранный срок цели короче рекомендуемого, план пропорционально сжимается,
 * чтобы все задачи уложились в срок, а порядок зависимостей сохранился.
 */
export function applyTemplate(t: GoalTemplate, input: TemplateApplyInput): TemplatePlan {
  const span = Math.max(0, diffDays(input.today, input.due_at));
  const factor = span < t.plan_days ? span / t.plan_days : 1;
  const at = (day: number) => addDays(input.today, Math.floor(day * factor + 1e-9));
  return {
    goal: {
      title: t.title,
      description: t.description,
      type: t.type,
      owner_id: input.owner_id,
      due_at: input.due_at,
      status: 'draft',
      metrics: [{ name: t.kpi.name, unit: t.kpi.unit, baseline: input.baseline ?? t.kpi.baseline, target: input.target ?? t.kpi.target, direction: t.kpi.direction }],
    },
    subgoals: t.subgoals.map((s) => ({ key: s.key, title: s.title })),
    tasks: t.tasks.map((k) => ({
      key: k.key,
      title: k.title,
      subgoal: k.subgoal ?? null,
      start_at: at(k.start),
      due_at: at(k.start + k.days),
      depends_on: k.after ?? [],
      definition_of_done: k.done,
    })),
  };
}

/** «2 подцели · 6 задач · 90 дней» — для карточки шаблона. */
export function templateSummary(t: GoalTemplate): string {
  const n = (v: number, forms: readonly [string, string, string]) => `${v} ${plural(v, forms)}`;
  return [n(t.subgoals.length, ['подцель', 'подцели', 'подцелей']), n(t.tasks.length, ['задача', 'задачи', 'задач']), n(t.plan_days, ['день', 'дня', 'дней'])].join(' · ');
}
