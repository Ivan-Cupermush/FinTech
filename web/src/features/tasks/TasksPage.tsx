import { ListChecks, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isOverdue, todayIso, type TaskStatus } from '@offix/core';
import { useTasks } from '../../lib/queries';
import type { Task } from '../../lib/types';
import { Button } from '../../ui/Button';
import { Empty, Skeleton, Tabs } from '../../ui/Misc';
import { TaskPanel } from './TaskPanel';
import { TaskRow } from './parts';

type Scope = 'mine' | 'all';

/** Порядок групп — по срочности: сначала то, где нужна помощь. */
export const TASK_GROUPS: { key: string; title: string; match: (t: Task, today: string) => boolean }[] = [
  { key: 'blocked', title: 'Заблокированы', match: (t) => t.status === 'blocked' },
  { key: 'overdue', title: 'Просрочены', match: (t, today) => t.status !== 'blocked' && isOverdue(t, today) },
  { key: 'in_progress', title: 'В работе', match: (t) => t.status === 'in_progress' },
  { key: 'review', title: 'На проверке', match: (t) => t.status === 'review' },
  { key: 'todo', title: 'К выполнению', match: (t) => t.status === 'todo' },
  { key: 'done', title: 'Готово', match: (t) => t.status === 'done' },
];

export function groupTasks(tasks: Task[], today: string) {
  const used = new Set<string>();
  return TASK_GROUPS.map((g) => {
    const items = tasks.filter((t) => !used.has(t.id) && t.status !== 'cancelled' && g.match(t, today));
    items.forEach((t) => used.add(t.id));
    items.sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'));
    return { ...g, items };
  }).filter((g) => g.items.length);
}

export function TasksPage() {
  const [scope, setScope] = useState<Scope>('mine');
  const [search, setSearch] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const q = useTasks(scope === 'mine' ? 'mine=1' : '');
  const today = todayIso();
  const groups = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = (q.data ?? []).filter((t) => !s || t.title.toLowerCase().includes(s) || t.assignee?.display_name.toLowerCase().includes(s));
    return groupTasks(list, today);
  }, [q.data, search, today]);
  const counts = (status: TaskStatus) => (q.data ?? []).filter((t) => t.status === status).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Задачи</h1>
          <p className="muted">{q.data ? `${counts('blocked') ? `${counts('blocked')} заблокировано · ` : ''}${counts('in_progress')} в работе` : ' '}</p>
        </div>
      </div>
      <div className="spread wrap" style={{ marginBottom: 20 }}>
        <Tabs
          label="Чьи задачи"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'mine', label: 'Мои' },
            { value: 'all', label: 'Все доступные' },
          ]}
        />
        <label className="row input" style={{ maxWidth: 280, gap: 8 }}>
          <Search size={16} className="faint" aria-hidden />
          <input aria-label="Поиск задач" placeholder="Найти задачу или человека" value={search} onChange={(e) => setSearch(e.target.value)} style={{ border: 0, outline: 0, background: 'none', width: '100%', padding: 0 }} />
        </label>
      </div>
      {q.isLoading ? (
        <div className="card stack">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={40} />
          ))}
        </div>
      ) : q.isError ? (
        <div className="card">
          <Empty title="Не удалось загрузить задачи" action={<Button onClick={() => q.refetch()}>Повторить</Button>}>
            {(q.error as Error).message}
          </Empty>
        </div>
      ) : groups.length ? (
        <div className="stack" style={{ '--gap': '20px' } as React.CSSProperties}>
          {groups.map((g) => (
            <section key={g.key} className="card" aria-labelledby={`tg-${g.key}`}>
              <div className="section-title">
                <h3 id={`tg-${g.key}`} style={{ color: g.key === 'blocked' ? 'var(--bad)' : g.key === 'overdue' ? 'var(--warn)' : undefined }}>
                  {g.title}
                </h3>
                <span className="faint num" style={{ fontSize: 13 }}>
                  {g.items.length}
                </span>
              </div>
              <div className="list">
                {g.items.map((t) => (
                  <TaskRow key={t.id} task={t} today={today} onOpen={setTaskId} showAssignee={scope === 'all'} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon={<ListChecks size={22} />} title={search ? 'Ничего не нашлось' : 'Задач нет'}>
            {search ? 'Попробуйте другой запрос.' : 'Задачи появляются из дорожных карт целей. Откройте цель и разбейте её на шаги.'}
          </Empty>
        </div>
      )}
      {taskId && <TaskPanel id={taskId} onClose={() => setTaskId(null)} />}
    </div>
  );
}
