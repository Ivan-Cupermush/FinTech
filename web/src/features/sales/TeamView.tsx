import { Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatNumber, formatRub, teamMemberLine } from '@offix/core';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Empty, Skeleton } from '../../ui/Misc';
import { useSalesPeople, useSalesTeam } from './data';

/** Команда за месяц: выручка, среднее выполнение плана и выплата каждого — к странице сотрудника. */
export function TeamView({ month }: { month: string }) {
  const team = useSalesTeam(month, true);
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const people = useSalesPeople('sales_assign', picking || !!team.data?.can.assign);
  if (team.isLoading) return <Skeleton h={180} r={20} />;
  if (!team.data) return null;
  const t = team.data;
  const link = (id: string) => `/app/sales/people/${id}?month=${month}`;
  const outside = (people.data ?? []).filter((p) => !t.members.some((m) => m.user.id === p.id));
  return (
    <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
      <section className="card card-tight" aria-label="Сотрудники">
        <div className="spread" style={{ marginBottom: 4, flexWrap: 'wrap' }}>
          <div>
            <h3 className="card-title">Сотрудники · {t.members.length}</h3>
            <div className="faint" style={{ fontSize: 13 }}>
              Выручка {formatRub(t.totals.revenue)} · заработано сейчас {formatRub(t.totals.now)} · прогноз выплат {formatRub(t.totals.forecast)} из {formatRub(t.totals.max)}
            </div>
          </div>
          {t.can.assign && outside.length > 0 && (
            <select className="select" style={{ maxWidth: 240 }} aria-label="Поставить план сотруднику" value="" onFocus={() => setPicking(true)} onChange={(e) => e.target.value && navigate(link(e.target.value))}>
              <option value="">Поставить план…</option>
              {outside.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {t.members.length ? (
          t.members.map((m) => (
            <Link key={m.user.id} to={link(m.user.id)} className="sl-member">
              <Avatar name={m.user.name} id={m.user.id} size={38} />
              <div style={{ minWidth: 0 }}>
                <div className="sl-member-name clip">{m.user.name}</div>
                <div className="faint sl-member-line">{[m.user.position, teamMemberLine(m)].filter(Boolean).join(' · ')}</div>
                {m.percent != null && (
                  <div className="bar sl-member-bar" aria-hidden>
                    <span style={{ width: `${Math.min(100, m.percent)}%`, background: m.percent >= 100 ? 'var(--good)' : 'var(--accent)' }} />
                  </div>
                )}
              </div>
              <div className="sl-member-pay">
                <b>{formatRub(m.totals.file ?? m.totals.forecast)}</b>
                {m.totals.file != null ? 'к выплате' : `прогноз${m.percent != null ? ` · ${formatNumber(m.percent, 0)} %` : ''}`}
              </div>
            </Link>
          ))
        ) : (
          <Empty icon={<Users size={22} />} title="В команде пока нет продаж" action={t.can.upload ? <Button onClick={() => navigate('/app/sales?tab=uploads')}>Загрузить отчёт 1С</Button> : undefined}>
            Сотрудники появятся здесь, когда у них будет план, отчёты 1С или записанные продажи за последние три месяца.
          </Empty>
        )}
      </section>
    </div>
  );
}
