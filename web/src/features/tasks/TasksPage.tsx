import { Archive, CalendarDays, Eye, HandHelping, List, ListChecks, ListTodo, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { archiveNote, byLight, isOverdue, monthOf, noteDayLabel, plural, taskCalendar, taskMonthGrid, tasksForDay, todayIso, type TaskStatus } from '@offix/core';
import { tasksHeroStats } from '../../lib/hero-stats';
import { useTasks } from '../../lib/queries';
import type { Task } from '../../lib/types';
import { Button } from '../../ui/Button';
import { Empty, Segmented, Skeleton, Tabs } from '../../ui/Misc';
import { Glass } from '../../ui/fx/Glass';
import { PageHero } from '../../ui/fx/PageHero';
import { gradientCss, gradientLook } from '../../ui/fx/gradients';
import { useDarkTheme } from '../../ui/fx/support';
import { MonthCalendar } from '../my-notes/Calendar';
import '../my-notes/my-notes.css';
import { RequestDialog } from './RequestDialog';
import { TaskPanel } from './TaskPanel';
import { TaskRow } from './parts';

export type Scope = 'mine' | 'all' | 'requests' | 'watching' | 'archive';
type View = 'list' | 'calendar';

/** Вкладка → запрос к API. Архив — отдельно: в остальных вкладках его нет. */
export const SCOPE_FILTER: Record<Scope, string> = {
  mine: 'mine=1',
  all: '',
  requests: 'created=1&kind=request',
  watching: 'watching=1',
  archive: 'archived=1',
};

const SCOPES: Scope[] = ['mine', 'all', 'requests', 'watching', 'archive'];

const EMPTY: Record<Scope, { title: string; text: string }> = {
  mine: { title: 'Задач нет', text: 'Задачи появляются из дорожных карт целей, а просьбы — от коллег.' },
  all: { title: 'Задач нет', text: 'Задачи появляются из дорожных карт целей. Откройте цель и разбейте её на шаги.' },
  requests: { title: 'Вы ещё ни о чём не просили', text: 'Нужна помощь коллеги из другого отдела? Отправьте просьбу — он отметит «Выполнено», а вы поблагодарите.' },
  watching: { title: 'Вы ни за чем не наблюдаете', text: 'Наблюдателя добавляет автор задачи: вы видите ход работы и отмечаете контрольные точки.' },
  archive: { title: 'Архив пуст', text: 'Выполненные и отменённые задачи уходят сюда сами через три дня.' },
};

/** Порядок групп — по срочности: сначала то, где нужна помощь. */
export const TASK_GROUPS: { key: string; title: string; match: (t: Task, today: string) => boolean }[] = [
  { key: 'blocked', title: 'Заблокированы', match: (t) => t.status === 'blocked' },
  { key: 'overdue', title: 'Просрочены', match: (t, today) => t.status !== 'blocked' && isOverdue(t, today) },
  { key: 'in_progress', title: 'В работе', match: (t) => t.status === 'in_progress' },
  { key: 'review', title: 'На проверке', match: (t) => t.status === 'review' },
  { key: 'todo', title: 'К выполнению', match: (t) => t.status === 'todo' },
  { key: 'done', title: 'Готово', match: (t) => t.status === 'done' },
];

/** Внутри группы — по светофору: красные, потом жёлтые; дальше по сроку. */
export function groupTasks(tasks: Task[], today: string) {
  const used = new Set<string>();
  return TASK_GROUPS.map((g) => {
    const items = byLight(
      tasks.filter((t) => !used.has(t.id) && t.status !== 'cancelled' && g.match(t, today)),
      today,
    );
    items.forEach((t) => used.add(t.id));
    return { ...g, items };
  }).filter((g) => g.items.length);
}

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get('scope') as Scope | null;
  const [scope, setScope] = useState<Scope>(initial && SCOPES.includes(initial) ? initial : 'mine');
  const [view, setView] = useState<View>(params.get('view') === 'calendar' ? 'calendar' : 'list');
  const [search, setSearch] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const today = todayIso();
  const [month, setMonth] = useState(monthOf(today));
  const [day, setDay] = useState<string | null>(null);
  const dark = useDarkTheme();
  const q = useTasks(SCOPE_FILTER[scope]);
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((t) => !s || t.title.toLowerCase().includes(s) || t.assignee?.display_name.toLowerCase().includes(s));
  }, [q.data, search]);
  const groups = useMemo(() => groupTasks(list, today), [list, today]);
  const counts = (status: TaskStatus) => (q.data ?? []).filter((t) => t.status === status).length;
  const archive = scope === 'archive';
  const calendar = view === 'calendar' && !archive;

  const switchScope = (s: Scope) => {
    setScope(s);
    const next = new URLSearchParams(params);
    if (s === 'mine') next.delete('scope');
    else next.set('scope', s);
    setParams(next, { replace: true });
  };
  const switchView = (v: View) => {
    setView(v);
    const next = new URLSearchParams(params);
    if (v === 'list') next.delete('view');
    else next.set('view', v);
    setParams(next, { replace: true });
  };
  const row = (t: Task) => <TaskRow key={t.id} task={t} today={today} onOpen={setTaskId} showAssignee={scope !== 'mine'} meta={archive ? archiveNote({ archived_at: t.archived?.at ?? null, archived_by_name: t.archived?.by_name }, today) : undefined} />;

  return (
    <div className="page">
      <PageHero
        variant="tasks"
        icon={ListTodo}
        title="Задачи"
        subtitle={archive ? 'Закрытые задачи уходят сюда сами через 3 дня. Автор или руководитель может вернуть задачу.' : q.data ? `${counts('blocked') ? `${counts('blocked')} заблокировано · ` : ''}${counts('in_progress')} в работе. Сначала — то, где нужна помощь.` : ' '}
        stats={q.data && !archive ? tasksHeroStats(q.data, today) : undefined}
        actions={
          <Button variant="primary" icon={<HandHelping size={16} />} onClick={() => setAsking(true)}>
            Попросить коллегу
          </Button>
        }
      />
      <div className="task-toolbar">
        <Tabs
          label="Чьи задачи"
          value={scope}
          onChange={switchScope}
          options={[
            { value: 'mine', label: 'Мои' },
            { value: 'all', label: 'Все доступные' },
            { value: 'requests', label: 'Мои просьбы' },
            { value: 'watching', label: 'Наблюдаю' },
            { value: 'archive', label: 'Архив' },
          ]}
        />
        <div className="task-tools">
          {!archive && (
            <Segmented
              label="Вид"
              value={view}
              onChange={switchView}
              options={[
                { value: 'list', label: <span className="row" style={{ gap: 6 }}><List size={15} aria-hidden /> Список</span> },
                { value: 'calendar', label: <span className="row" style={{ gap: 6 }}><CalendarDays size={15} aria-hidden /> Календарь</span> },
              ]}
            />
          )}
          <label className="row input task-search">
            <Search size={16} className="faint" aria-hidden />
            <input aria-label="Поиск задач" placeholder="Найти задачу или человека" value={search} onChange={(e) => setSearch(e.target.value)} style={{ border: 0, outline: 0, background: 'none', width: '100%', padding: 0 }} />
          </label>
        </div>
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
      ) : calendar ? (
        <TaskCalendarView tasks={list} today={today} month={month} day={day} onMonth={setMonth} onDay={setDay} dark={dark} row={row} />
      ) : archive && list.length ? (
        <section className="card" aria-labelledby="tg-archive">
          <div className="section-title">
            <h3 id="tg-archive">В архиве</h3>
            <span className="faint num" style={{ fontSize: 13 }}>
              {list.length}
            </span>
          </div>
          <div className="list">{list.map(row)}</div>
        </section>
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
              <div className="list">{g.items.map(row)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty
            icon={archive ? <Archive size={22} /> : scope === 'watching' ? <Eye size={22} /> : scope === 'requests' ? <HandHelping size={22} /> : <ListChecks size={22} />}
            title={search ? 'Ничего не нашлось' : EMPTY[scope].title}
            action={scope === 'requests' && !search ? <Button onClick={() => setAsking(true)}>Попросить коллегу</Button> : undefined}
          >
            {search ? 'Попробуйте другой запрос.' : EMPTY[scope].text}
          </Empty>
        </div>
      )}
      {taskId && <TaskPanel id={taskId} onClose={() => setTaskId(null)} />}
      {asking && (
        <RequestDialog
          onClose={() => setAsking(false)}
          onCreated={() => {
            if (scope !== 'requests' && scope !== 'all') switchScope('requests');
          }}
        />
      )}
    </div>
  );
}

/** Календарь задач: месяц на градиенте под стеклом, рядом — сроки выбранного дня или ближайшей недели. */
function TaskCalendarView({
  tasks,
  today,
  month,
  day,
  onMonth,
  onDay,
  dark,
  row,
}: {
  tasks: Task[];
  today: string;
  month: string;
  day: string | null;
  onMonth: (m: string) => void;
  onDay: (d: string | null) => void;
  dark: boolean;
  row: (t: Task) => React.ReactNode;
}) {
  const days = taskCalendar(tasks, month, today);
  const total = days.reduce((s, d) => s + d.count, 0);
  const late = days.reduce((s, d) => s + d.late, 0);
  const items = tasksForDay(tasks, day, today);
  const byDay = new Map<string, Task[]>();
  for (const t of items) byDay.set(t.due_at!, [...(byDay.get(t.due_at!) ?? []), t]);
  const overdue = day ? [] : tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled' && isOverdue(t, today));
  return (
    <div className="mn-layout">
      <aside className="mn-side" style={{ background: gradientCss(gradientLook('tasks', dark)) }}>
        <Glass className="mn-cal-glass" radius={24} overLight={false} elasticity={0} displacement={36} blur={0.3} clip>
          <MonthCalendar
            label="Календарь задач"
            month={month}
            today={today}
            selected={day}
            weeks={taskMonthGrid(month, days, { today, selected: day })}
            summary={total ? `${total} ${plural(total, ['срок', 'срока', 'сроков'])}${late ? ` · ${late} ${plural(late, ['просрочен', 'просрочены', 'просрочены'])}` : ''}` : 'сроков нет'}
            cellLabel={(c) => (c.count ? `, сроков: ${c.count}${c.late ? `, просрочено: ${c.late}` : ''}` : '')}
            onMonth={onMonth}
            onSelect={onDay}
          />
        </Glass>
        <div className="mn-side-foot">
          <button
            type="button"
            className="mn-today"
            onClick={() => {
              onMonth(monthOf(today));
              onDay(today);
            }}
          >
            <CalendarDays size={15} aria-hidden /> Сегодня
          </button>
          {day && (
            <button type="button" className="mn-today" onClick={() => onDay(null)}>
              Ближайшая неделя
            </button>
          )}
        </div>
      </aside>
      <section className="card" aria-label="Сроки">
        <div className="tcal-heading">
          <h2>{day ? noteDayLabel(day, today) : 'Ближайшая неделя'}</h2>
          <span className="faint num" style={{ fontSize: 13 }}>
            {items.length ? `${items.length} ${plural(items.length, ['задача', 'задачи', 'задач'])}` : ''}
          </span>
        </div>
        {overdue.length > 0 && (
          <>
            <div className="tcal-day" style={{ color: 'var(--warn)' }}>
              Просрочены
            </div>
            <div className="list">{overdue.map(row)}</div>
          </>
        )}
        {items.length ? (
          [...byDay.entries()].map(([d, list]) => (
            <div key={d}>
              {!day && <div className="tcal-day">{noteDayLabel(d, today)}</div>}
              <div className="list">{list.map(row)}</div>
            </div>
          ))
        ) : (
          !overdue.length && (
            <Empty icon={<CalendarDays size={22} />} title={day ? 'В этот день сроков нет' : 'На неделе сроков нет'}>
              Выберите другой день в календаре.
            </Empty>
          )
        )}
      </section>
    </div>
  );
}
