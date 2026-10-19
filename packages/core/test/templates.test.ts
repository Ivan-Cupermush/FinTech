import { describe, expect, it } from 'vitest';
import {
  GOAL_TEMPLATES,
  TEMPLATE_AREAS,
  addDays,
  applyTemplate,
  findTemplate,
  searchTemplates,
  templateDueDate,
  templateSummary,
  titleHint,
  validateGoal,
  validateMetric,
} from '../src';

const TODAY = '2026-10-19';

describe('каталог шаблонов', () => {
  it('8–10 шаблонов с уникальными ключами, у каждого направления есть шаблон', () => {
    expect(GOAL_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    expect(GOAL_TEMPLATES.length).toBeLessThanOrEqual(10);
    expect(new Set(GOAL_TEMPLATES.map((t) => t.key)).size).toBe(GOAL_TEMPLATES.length);
    for (const a of TEMPLATE_AREAS) expect(GOAL_TEMPLATES.some((t) => t.area === a)).toBe(true);
  });

  describe.each(GOAL_TEMPLATES.map((t) => [t.key, t] as const))('%s', (_key, t) => {
    it('название — результат, а не действие', () => {
      expect(titleHint(t.title)).toBeNull();
      for (const s of t.subgoals) expect(titleHint(s.title)).toBeNull();
    });

    it('KPI валиден, а подсказки заполнены', () => {
      expect(validateMetric(t.kpi)).toEqual({});
      expect(t.kpi.hint.length).toBeGreaterThan(10);
      expect(t.kpi.source.length).toBeGreaterThan(10);
    });

    it('2–3 подцели, 4–8 задач, задачи ссылаются на свои подцели', () => {
      expect(t.subgoals.length).toBeGreaterThanOrEqual(2);
      expect(t.subgoals.length).toBeLessThanOrEqual(3);
      expect(t.tasks.length).toBeGreaterThanOrEqual(4);
      expect(t.tasks.length).toBeLessThanOrEqual(8);
      const sub = new Set(t.subgoals.map((s) => s.key));
      for (const k of t.tasks) if (k.subgoal) expect(sub.has(k.subgoal)).toBe(true);
      // У каждой подцели есть хотя бы одна задача.
      for (const s of t.subgoals) expect(t.tasks.some((k) => k.subgoal === s.key)).toBe(true);
    });

    it('зависимости — только на более ранние задачи, которые успевают закончиться', () => {
      const seen = new Map<string, number>();
      for (const k of t.tasks) {
        for (const d of k.after ?? []) {
          expect(seen.has(d), `${k.key} → ${d}`).toBe(true);
          expect(seen.get(d)!).toBeLessThanOrEqual(k.start);
        }
        expect(k.days).toBeGreaterThan(0);
        expect(k.start + k.days).toBeLessThanOrEqual(t.plan_days);
        seen.set(k.key, k.start + k.days);
      }
    });

    it('черновик из шаблона проходит полную проверку цели', () => {
      const plan = applyTemplate(t, { owner_id: 'u1', due_at: templateDueDate(t, TODAY), today: TODAY });
      expect(validateGoal(plan.goal, 'active', TODAY)).toEqual({});
      expect(plan.goal.status).toBe('draft');
    });
  });
});

describe('applyTemplate', () => {
  const t = findTemplate('application-time')!;

  it('подставляет владельца, срок и свои цифры', () => {
    const plan = applyTemplate(t, { owner_id: 'olga', due_at: '2027-01-31', today: TODAY, baseline: 52, target: 35 });
    expect(plan.goal).toMatchObject({ title: 'Сократить время обработки заявки студента', type: 'operational', owner_id: 'olga', due_at: '2027-01-31' });
    expect(plan.goal.metrics).toEqual([{ name: 'Среднее время обработки заявки', unit: 'minutes', baseline: 52, target: 35, direction: 'decrease' }]);
  });

  it('сроки задач — от старта, зависимости по ключам', () => {
    const plan = applyTemplate(t, { owner_id: 'u', due_at: templateDueDate(t, TODAY), today: TODAY });
    const map = plan.tasks.find((k) => k.key === 'map')!;
    expect(map).toMatchObject({ start_at: TODAY, due_at: addDays(TODAY, 10), subgoal: 'route', depends_on: [] });
    expect(plan.tasks.find((k) => k.key === 'train')).toMatchObject({ start_at: addDays(TODAY, 40), subgoal: null, depends_on: ['approve', 'autofill', 'answers'] });
  });

  it('короткий срок сжимает план: всё укладывается, порядок не нарушен', () => {
    const due = addDays(TODAY, 30);
    const plan = applyTemplate(t, { owner_id: 'u', due_at: due, today: TODAY });
    const byKey = new Map(plan.tasks.map((k) => [k.key, k]));
    for (const k of plan.tasks) {
      expect(k.due_at <= due).toBe(true);
      expect(k.start_at <= k.due_at).toBe(true);
      for (const d of k.depends_on) expect(byKey.get(d)!.due_at <= k.start_at).toBe(true);
    }
  });

  it('свои цифры не в ту сторону — validateGoal ловит ошибку', () => {
    const plan = applyTemplate(t, { owner_id: 'u', due_at: '2027-01-31', today: TODAY, baseline: 30, target: 40 });
    expect(validateGoal(plan.goal, 'active', TODAY)['metrics.0.target']).toMatch(/меньше исходного/);
  });
});

describe('поиск шаблонов', () => {
  it('по словам из названия и KPI, без учёта регистра и «ё»', () => {
    expect(searchTemplates(GOAL_TEMPLATES, 'договор').map((t) => t.key)).toEqual(['contract-approval']);
    expect(searchTemplates(GOAL_TEMPLATES, 'NPS').map((t) => t.key)).toEqual(['student-nps']);
    expect(searchTemplates(GOAL_TEMPLATES, 'заявк студент').map((t) => t.key)).toContain('application-time');
  });

  it('фильтр по направлению', () => {
    const it_ = searchTemplates(GOAL_TEMPLATES, '', 'it');
    expect(it_.length).toBeGreaterThan(0);
    expect(it_.every((t) => t.area === 'it')).toBe(true);
    expect(searchTemplates(GOAL_TEMPLATES, '')).toHaveLength(GOAL_TEMPLATES.length);
  });

  it('сводка для карточки', () => {
    expect(templateSummary(findTemplate('application-time')!)).toBe('2 подцели · 6 задач · 90 дней');
  });
});
