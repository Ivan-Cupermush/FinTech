import { describe, expect, it } from 'vitest';
import { analyzeRisks, type RiskInput, type RiskTask } from '../src/risk';

const today = '2026-11-10';
const metric = { id: 'm1', name: 'Время обработки', baseline: 40, target: 30, direction: 'decrease' as const, current_value: 37, last_observed_at: '2026-11-08T10:00:00Z' };

function input(tasks: RiskTask[], extra: Partial<RiskInput> = {}): RiskInput {
  return { goal: { status: 'active', due_at: '2026-12-31' }, tasks, edges: [], metrics: [metric], today, ...extra };
}

describe('analyzeRisks', () => {
  it('всё хорошо — рисков нет', () => {
    expect(analyzeRisks(input([{ id: 't1', title: 'Анализ', status: 'in_progress', due_at: '2026-11-20' }]))).toEqual([]);
  });

  it('сценарий В: блокировка с причиной, длительностью и тем, кого она держит', () => {
    const risks = analyzeRisks(
      input(
        [
          { id: 't1', title: 'Автопроверка', status: 'blocked', due_at: '2026-11-20', blocked_reason: 'approval', blocked_note: 'юристы', blocked_since: '2026-11-05T09:00:00Z', assignee_name: 'Дмитрий' },
          { id: 't2', title: 'Тест', status: 'todo', due_at: '2026-11-25' },
        ],
        { edges: [{ from: 't1', to: 't2' }] },
      ),
    );
    const r = risks.find((x) => x.kind === 'blocked')!;
    expect(r.severity).toBe('critical');
    expect(r.explanation).toContain('Ждём согласования: юристы');
    expect(r.explanation).toContain('5 дней');
    expect(r.explanation).toContain('Ждут 1 задача');
    expect(r.suggestion).toContain('Дмитрий');
    expect(r.task_ids).toEqual(['t1', 't2']);
  });

  it('свежая блокировка без зависимых — предупреждение', () => {
    const risks = analyzeRisks(input([{ id: 't1', title: 'A', status: 'blocked', due_at: '2026-11-20', blocked_since: '2026-11-10T08:00:00Z' }]));
    expect(risks[0]!.severity).toBe('warning');
    expect(risks[0]!.explanation).toContain('сегодня');
  });

  it('просроченная задача', () => {
    const risks = analyzeRisks(input([{ id: 't1', title: 'Регламент', status: 'in_progress', due_at: '2026-11-07' }]));
    const r = risks.find((x) => x.kind === 'overdue')!;
    expect(r.title).toBe('«Регламент» просрочена на 3 дня');
  });

  it('сценарий А + Б: задержка сдвигает зависимые и срок цели', () => {
    const risks = analyzeRisks(
      input(
        [
          { id: 'it', title: 'Автоматизация', status: 'in_progress', start_at: '2026-11-01', due_at: '2026-11-05' },
          { id: 'qa', title: 'Приёмка', status: 'todo', start_at: '2026-11-06', due_at: '2026-11-14' },
        ],
        { edges: [{ from: 'it', to: 'qa' }], goal: { status: 'active', due_at: '2026-11-15' } },
      ),
    );
    const dep = risks.find((x) => x.kind === 'dependency_delay')!;
    expect(dep.proposals).toHaveLength(1);
    expect(dep.explanation).toContain('«Автоматизация»');
    expect(dep.suggestion).toMatch(/не меняет/);
    const goal = risks.find((x) => x.kind === 'goal_deadline')!;
    expect(goal.severity).toBe('critical');
    expect(goal.explanation).toContain('«Приёмка»');
    expect(risks[0]!.severity).toBe('critical');
  });

  it('сценарий Г: задачи закрыты, KPI не достигнут', () => {
    const risks = analyzeRisks(input([{ id: 't1', title: 'A', status: 'done', due_at: '2026-11-05', done_at: '2026-11-05T00:00:00Z' }]));
    const r = risks.find((x) => x.kind === 'kpi_not_moving')!;
    expect(r.explanation).toContain('30 %');
  });

  it('сценарий Г без измерений', () => {
    const risks = analyzeRisks(
      input([{ id: 't1', title: 'A', status: 'done', due_at: '2026-11-05' }], { metrics: [{ ...metric, current_value: null, last_observed_at: null }] }),
    );
    expect(risks.find((x) => x.kind === 'kpi_not_moving')!.explanation).toMatch(/измерений KPI нет/);
    expect(risks.find((x) => x.kind === 'no_measurement')).toBeDefined();
  });

  it('достигнутый KPI не даёт сценарий Г', () => {
    const risks = analyzeRisks(
      input([{ id: 't1', title: 'A', status: 'done', due_at: '2026-11-05' }], { metrics: [{ ...metric, current_value: 29 }] }),
    );
    expect(risks.find((x) => x.kind === 'kpi_not_moving')).toBeUndefined();
  });

  it('устаревшие измерения', () => {
    const risks = analyzeRisks(input([], { metrics: [{ ...metric, last_observed_at: '2026-10-01T00:00:00Z' }] }));
    expect(risks.find((x) => x.kind === 'no_measurement')!.explanation).toContain('40 дней');
  });

  it('у черновика нет рисков по срокам и измерениям', () => {
    const risks = analyzeRisks(input([], { goal: { status: 'draft', due_at: '2026-11-01' }, metrics: [{ ...metric, last_observed_at: null }] }));
    expect(risks).toEqual([]);
  });
});
