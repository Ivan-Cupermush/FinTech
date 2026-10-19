import { ArrowRight, HandHelping, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDate } from '@offix/core';
import { useDashboard, useMe } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { Empty, Skeleton } from '../../ui/Misc';
import { GoalTile, RiskList } from '../goals/parts';
import { TaskPanel } from '../tasks/TaskPanel';
import { TaskRow } from '../tasks/parts';

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 6 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}

/** Пульс — главный экран: что изменилось в показателях, что под угрозой, кому помочь. */
export function PulsePage() {
  const me = useMe();
  const dash = useDashboard();
  const navigate = useNavigate();
  const [taskId, setTaskId] = useState<string | null>(null);
  const d = dash.data;
  const firstName = me.data?.display_name.split(' ')[0];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{d ? formatDate(d.today, { today: '0000' }) : ' '}</div>
          <h1 style={{ marginTop: 6 }}>
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          {d && (
            <p className="muted">
              {d.risks.filter((r) => r.severity === 'critical').length
                ? `${d.risks.filter((r) => r.severity === 'critical').length} ${d.risks.filter((r) => r.severity === 'critical').length === 1 ? 'вопрос требует' : 'вопроса требуют'} решения сегодня.`
                : 'Критичных вопросов нет — цели идут по плану.'}
            </p>
          )}
        </div>
        <Button className="mobile-only" variant="primary" icon={<Plus size={16} />} onClick={() => navigate("/app/goals/new")}>
          Новая цель
        </Button>
      </div>

      {dash.isLoading && (
        <div className="grid-cards">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card stack">
              <Skeleton h={14} w="40%" />
              <Skeleton h={22} w="80%" />
              <Skeleton h={36} />
            </div>
          ))}
        </div>
      )}

      {d && (
        <div className="stack" style={{ '--gap': '28px' } as React.CSSProperties}>
          {d.goals.length ? (
            <section aria-labelledby="goals-h">
              <div className="section-title">
                <h3 id="goals-h">Цели в работе</h3>
                <Link to="/app/goals" className="row muted" style={{ gap: 4, fontSize: 14 }}>
                  Все цели <ArrowRight size={14} />
                </Link>
              </div>
              <div className="grid-cards">
                {d.goals.map((g) => (
                  <GoalTile key={g.id} goal={g} today={d.today} />
                ))}
              </div>
            </section>
          ) : (
            <div className="card">
              <Empty icon={<Sparkles size={22} />} title="Начните с одной измеримой цели" action={<Button variant="primary" onClick={() => navigate('/app/goals/new')}>Создать цель</Button>}>
                Опишите, какой показатель должен измениться, — offix построит дорожную карту и покажет, где теряется время.
              </Empty>
            </div>
          )}

          <div className="grid-2">
            <section className="card" aria-labelledby="risk-h">
              <div className="section-title">
                <h3 id="risk-h">Требует внимания</h3>
                <span className="faint num" style={{ fontSize: 13 }}>
                  {d.risks.length}
                </span>
              </div>
              {d.risks.length ? (
                <RiskList risks={d.risks} showGoal onTask={setTaskId} />
              ) : (
                <Empty icon={<ShieldCheck size={22} />} title="Всё под контролем">
                  Блокеров и задержек нет. Мы сообщим, если что-то начнёт угрожать срокам.
                </Empty>
              )}
            </section>
            <div className="stack" style={{ '--gap': '20px' } as React.CSSProperties}>
              {d.help_needed.length > 0 && (
                <section className="card" aria-labelledby="help-h">
                  <div className="section-title">
                    <h3 id="help-h">
                      <HandHelping size={18} /> Кому нужна помощь
                    </h3>
                  </div>
                  <div className="list">
                    {d.help_needed.map((t) => (
                      <TaskRow key={t.id} task={t} today={d.today} onOpen={setTaskId} />
                    ))}
                  </div>
                </section>
              )}
              <section className="card" aria-labelledby="my-h">
                <div className="section-title">
                  <h3 id="my-h">Мои задачи</h3>
                  <Link to="/app/tasks" className="row muted" style={{ gap: 4, fontSize: 14 }}>
                    Все <ArrowRight size={14} />
                  </Link>
                </div>
                {d.my_tasks.length ? (
                  <div className="list">
                    {d.my_tasks.slice(0, 6).map((t) => (
                      <TaskRow key={t.id} task={t} today={d.today} onOpen={setTaskId} showAssignee={false} />
                    ))}
                  </div>
                ) : (
                  <p className="faint">Открытых задач нет.</p>
                )}
              </section>
              {d.drafts.length > 0 && (
                <section className="card card-tight">
                  <div className="eyebrow" style={{ marginBottom: 8 }}>
                    Черновики
                  </div>
                  {d.drafts.map((g) => (
                    <Link key={g.id} to={`/app/goals/${g.id}`} className="list-row">
                      <span className="grow clip">{g.title}</span>
                      <span className="faint" style={{ fontSize: 13 }}>
                        Дозаполнить →
                      </span>
                    </Link>
                  ))}
                </section>
              )}
            </div>
          </div>
        </div>
      )}
      {taskId && <TaskPanel id={taskId} onClose={() => setTaskId(null)} />}
    </div>
  );
}
