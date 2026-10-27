import { ArrowLeft, CalendarClock, FileSpreadsheet, LayoutGrid, Settings2, Users, Wallet } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { coverageText, formatNumber, formatRub, moscowDay, plansLine, type SalesMonth } from '@offix/core';
import { heroMoney, salesHeroStats } from '../../lib/hero-stats';
import { useMe } from '../../lib/queries';
import { PageHero, type HeroStat } from '../../ui/fx/PageHero';
import { Empty, Segmented, Skeleton } from '../../ui/Misc';
import { useSalesEmployee, useSalesMonth, useSalesTeam } from './data';
import { MonthView } from './MonthView';
import { MonthSwitcher } from './parts';
import { SettingsTab } from './Settings';
import { TeamView } from './TeamView';
import { UploadsTab } from './Uploads';
import './sales.css';

type Tab = 'month' | 'team' | 'uploads' | 'settings';
const TABS: Tab[] = ['month', 'team', 'uploads', 'settings'];

/** «Сегодня» в продажах — по Москве: отчёты 1С и месяцы считаются так же на сервере. */
const salesToday = () => moscowDay(new Date().toISOString());

function useMonthParam(): [string, string, (m: string) => void, URLSearchParams, (p: URLSearchParams) => void] {
  const [params, setParams] = useSearchParams();
  const today = salesToday();
  const raw = params.get('month');
  const month = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : today.slice(0, 7);
  const set = (m: string) => {
    const next = new URLSearchParams(params);
    if (m === today.slice(0, 7)) next.delete('month');
    else next.set('month', m);
    setParams(next, { replace: true });
  };
  return [month, today, set, params, (p) => setParams(p, { replace: true })];
}

const teamStats = (t: { members: unknown[]; totals: { revenue: number; forecast: number } }): HeroStat[] => [
  { label: 'сотрудников с продажами', value: t.members.length },
  { label: 'выручка команды', value: heroMoney(t.totals.revenue) },
  { label: 'прогноз выплат', value: heroMoney(t.totals.forecast) },
];

const subtitleOf = (m: SalesMonth) => `${coverageText(m.coverage)} · ${plansLine(m.plans).toLowerCase()}`;

/**
 * Продажи и KPI с выплатами: мой месяц (план, выплата, продажи), команда,
 * загрузки отчётов 1С и файлов KPI, настройки (списки клиентов, менеджеры
 * из отчётов, KPI целей из продаж).
 */
export function SalesPage() {
  const [month, today, setMonth, params, setParams] = useMonthParam();
  const m = useSalesMonth(month);
  const can = m.data?.can;
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) && (raw === 'month' || can?.team) ? raw : 'month';
  const team = useSalesTeam(month, !!can?.team && tab !== 'month');
  const go = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === 'month') next.delete('tab');
    else next.set('tab', t);
    setParams(next);
  };

  return (
    <div className="page">
      <PageHero
        variant="sales"
        icon={Wallet}
        eyebrow="Продажи и KPI"
        title={tab === 'month' ? 'Мои продажи' : 'Продажи команды'}
        subtitle={m.data ? (tab === 'month' ? subtitleOf(m.data) : coverageText(m.data.coverage)) : 'План на месяц, выплаты и продажи по отчётам 1С'}
        stats={tab !== 'month' && team.data ? teamStats(team.data) : m.data ? salesHeroStats(m.data) : undefined}
      />
      <div className="sl-toolbar" style={{ marginBottom: 16 }}>
        {can?.team ? (
          <Segmented<Tab>
            label="Раздел продаж"
            value={tab}
            onChange={go}
            options={[
              { value: 'month', label: <><LayoutGrid size={13} /> Мой месяц</> },
              { value: 'team', label: <><Users size={13} /> Команда</> },
              { value: 'uploads', label: <><FileSpreadsheet size={13} /> Загрузки</> },
              { value: 'settings', label: <><Settings2 size={13} /> Настройки</> },
            ]}
          />
        ) : (
          <span />
        )}
        <MonthSwitcher month={month} current={today.slice(0, 7)} onChange={setMonth} />
      </div>
      {m.isLoading ? (
        <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
          <Skeleton h={150} r={28} />
          <Skeleton h={220} r={20} />
        </div>
      ) : m.isError || !m.data ? (
        <div className="card">
          <Empty title="Не удалось открыть продажи">{(m.error as Error | null)?.message ?? 'Попробуйте обновить страницу'}</Empty>
        </div>
      ) : tab === 'team' ? (
        <TeamView month={month} />
      ) : tab === 'uploads' ? (
        <UploadsTab reports={m.data.can.reports} kpi={!!team.data?.can.kpi_files} onSettings={() => go('settings')} />
      ) : tab === 'settings' ? (
        <SettingsTab month={month} can={m.data.can.reports} />
      ) : (
        <MonthView m={m.data} today={today} self />
      )}
    </div>
  );
}

/** Страница сотрудника в продажах: его месяц, задачи и что он продаёт. */
export function SalesEmployeePage() {
  const { id = '' } = useParams();
  const [month, today, setMonth] = useMonthParam();
  const me = useMe();
  const e = useSalesEmployee(id, month);
  const d = e.data;
  const back = (
    <Link to={`/app/sales?tab=team${month !== today.slice(0, 7) ? `&month=${month}` : ''}`}>
      <ArrowLeft size={15} aria-hidden /> Команда
    </Link>
  );
  return (
    <div className="page">
      <PageHero
        variant="sales"
        icon={Wallet}
        back={back}
        eyebrow={d?.month.user.position ?? 'Продажи сотрудника'}
        title={d?.month.user.name ?? 'Сотрудник'}
        subtitle={d ? subtitleOf(d.month) : undefined}
        stats={d ? salesHeroStats(d.month) : undefined}
      />
      <div className="sl-toolbar" style={{ marginBottom: 16 }}>
        <span />
        <MonthSwitcher month={month} current={today.slice(0, 7)} onChange={setMonth} />
      </div>
      {e.isLoading ? (
        <Skeleton h={260} r={20} />
      ) : !d ? (
        <div className="card">
          <Empty title="Сотрудник не найден">{(e.error as Error | null)?.message ?? 'Его продажи вам не видны'}</Empty>
        </div>
      ) : (
        <div className="grid-2">
          <MonthView m={d.month} today={today} self={d.month.user.id === me.data?.id} />
          <div className="sl-side">
            <section className="card card-tight stack" style={{ '--gap': '10px' } as React.CSSProperties} aria-label="Задачи сотрудника">
              <div className="spread">
                <h3 className="card-title">Задачи</h3>
                <CalendarClock size={16} className="faint" aria-hidden />
              </div>
              <div className="sl-kv">
                <div>
                  <b>{d.tasks.open}</b>в работе
                </div>
                <div>
                  <b data-tone={d.tasks.overdue ? 'bad' : undefined}>{d.tasks.overdue}</b>просрочены
                </div>
                <div>
                  <b data-tone={d.tasks.blocked ? 'bad' : undefined}>{d.tasks.blocked}</b>с блокером
                </div>
                <div>
                  <b>{d.tasks.done_30d}</b>сделано за 30 дней
                </div>
              </div>
              <Link to={`/app/people/${d.month.user.id}`} className="faint" style={{ fontSize: 13 }}>
                Профиль сотрудника →
              </Link>
            </section>
            <section className="card card-tight" aria-label="Что продаёт">
              <h3 className="card-title" style={{ marginBottom: 4 }}>
                Что продаёт
              </h3>
              {d.top_products.length ? (
                <div className="list">
                  {d.top_products.map((p) => (
                    <div key={p.name} className="list-row">
                      <span className="grow clip">{p.name}</span>
                      <span className="faint num" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                        {formatNumber(p.quantity, 2)} шт
                      </span>
                      <span className="num" style={{ whiteSpace: 'nowrap' }}>
                        {formatRub(p.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="faint" style={{ fontSize: 13, padding: '6px 0' }}>
                  За месяц продаж нет.
                </p>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
