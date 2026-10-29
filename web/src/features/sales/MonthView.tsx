import { FileSpreadsheet, ListPlus, Plus, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { formatDate, formatNumber, formatRub, plansLine, type SalesMonth, type SalesPlan } from '@offix/core';
import { Button } from '../../ui/Button';
import { Empty, Skeleton } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { salesApi, useSalesEntries, useSalesMutation } from './data';
import { EntryDialog, FactDialog, ImportEntriesDialog, PlanDialog } from './dialogs';
import { KpiFileDialog } from './Uploads';
import { EditButton, errorText, PayoutPanel, PlanCard } from './parts';

/**
 * Месяц сотрудника: выплата, показатели плана и продажи, записанные вручную.
 * Тот, кто ставит план, добавляет и правит показатели и загружает файл KPI;
 * сотрудник отмечает факт своих «ручных» показателей и записывает продажи.
 */
export function MonthView({ m, today, self }: { m: SalesMonth; today: string; self: boolean }) {
  const [dialog, setDialog] = useState<null | { kind: 'plan'; plan?: SalesPlan } | { kind: 'fact'; plan: SalesPlan } | { kind: 'entry' } | { kind: 'import' } | { kind: 'kpi' }>(null);
  const user = self ? undefined : m.user.id;
  const close = () => setDialog(null);
  const actions = (
    <div className="row wrap" style={{ gap: 8 }}>
      {m.can.edit && (
        <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setDialog({ kind: 'plan' })}>
          Показатель
        </Button>
      )}
      {m.can.kpi_file && (
        <Button size="sm" icon={<FileSpreadsheet size={14} />} onClick={() => setDialog({ kind: 'kpi' })}>
          Файл KPI
        </Button>
      )}
      {m.can.add_entry && (
        <>
          <Button size="sm" icon={<ListPlus size={14} />} onClick={() => setDialog({ kind: 'entry' })}>
            Записать продажу
          </Button>
          <Button size="sm" variant="ghost" icon={<Upload size={14} />} onClick={() => setDialog({ kind: 'import' })}>
            Из Excel
          </Button>
        </>
      )}
    </div>
  );

  return (
    <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
      {m.plans.length > 0 && <PayoutPanel m={m} />}
      <div className="sl-section-head">
        <h2>
          План на месяц <span className="faint" style={{ fontWeight: 400, fontSize: 14 }}>· {plansLine(m.plans)}</span>
        </h2>
        {actions}
      </div>
      {m.plans.length ? (
        <div className="sl-plans">
          {m.plans.map((p) => {
            const ownFact = m.can.fact && !m.can.edit && p.source === 'manual' && p.fact_rule.type === 'manual' && p.payout_rule.type !== 'fixed';
            return (
              <PlanCard
                key={p.id}
                p={p}
                today={today}
                actions={
                  m.can.edit ? (
                    <EditButton label={`Изменить «${p.name}»`} onClick={() => setDialog({ kind: 'plan', plan: p })} />
                  ) : ownFact ? (
                    <EditButton label={`Отметить факт «${p.name}»`} onClick={() => setDialog({ kind: 'fact', plan: p })} />
                  ) : undefined
                }
              />
            );
          })}
        </div>
      ) : (
        <div className="card">
          <Empty title="План на месяц не задан" action={m.can.edit ? <Button onClick={() => setDialog({ kind: 'plan' })}>Добавить показатель</Button> : undefined}>
            {m.can.edit
              ? 'Добавьте показатели вручную или загрузите файл KPI: план, бонус и правило выплаты по каждому.'
              : self
                ? 'Руководитель ещё не поставил план. Пока можно записывать продажи — они сохранятся за месяцем.'
                : 'Плана на этот месяц нет.'}
          </Empty>
        </div>
      )}
      <EntriesSection month={m.month} user={user} show={m.can.add_entry || m.entries.count > 0} />
      {dialog?.kind === 'plan' && <PlanDialog userId={m.user.id} month={m.month} plan={dialog.plan} onClose={close} />}
      {dialog?.kind === 'fact' && <FactDialog plan={dialog.plan} onClose={close} />}
      {dialog?.kind === 'entry' && <EntryDialog userId={user} plans={m.plans} today={today} onClose={close} />}
      {dialog?.kind === 'import' && <ImportEntriesDialog userId={user} plans={m.plans} onClose={close} />}
      {dialog?.kind === 'kpi' && <KpiFileDialog user={m.user} month={m.month} onClose={close} />}
    </div>
  );
}

/** Продажи, записанные вручную или из Excel. */
function EntriesSection({ month, user, show }: { month: string; user?: string; show: boolean }) {
  const entries = useSalesEntries(month, user);
  const toast = useToast();
  const remove = useSalesMutation((id: string) => salesApi.deleteEntry(id));
  if (!show) return null;
  const list = entries.data ?? [];
  const total = list.reduce((s, e) => s + e.amount, 0);
  return (
    <section className="card card-tight" aria-label="Записанные продажи">
      <div className="spread" style={{ marginBottom: 4 }}>
        <h3 className="card-title">Записанные продажи</h3>
        {list.length > 0 && (
          <span className="faint num" style={{ fontSize: 13 }}>
            {list.length} · {formatRub(total)}
          </span>
        )}
      </div>
      {entries.isLoading ? (
        <Skeleton h={40} />
      ) : list.length ? (
        <div className="list">
          {list.slice(0, 50).map((e) => (
            <div key={e.id} className="list-row">
              <span className="faint num" style={{ width: 64, flex: 'none', fontSize: 13 }}>
                {formatDate(e.sold_on, { short: true })}
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="clip">{e.product}</div>
                {(e.client || e.note) && (
                  <div className="faint clip" style={{ fontSize: 12.5 }}>
                    {[e.client, e.note].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              <span className="num" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {formatRub(e.amount)}
                {e.quantity !== 1 && (
                  <span className="faint" style={{ display: 'block', fontSize: 12 }}>
                    {formatNumber(e.quantity, 2)} шт
                  </span>
                )}
              </span>
              {e.can_delete && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 size={14} />}
                  aria-label={`Удалить продажу «${e.product}»`}
                  onClick={() => remove.mutate(e.id, { onSuccess: () => toast('Продажа удалена'), onError: (x) => toast(errorText(x), 'error') })}
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 14, padding: '8px 0' }}>
          Продаж вручную за месяц нет. Записывайте то, чего нет в отчётах 1С: вебинары, разовые услуги, продажи без накладной.
        </p>
      )}
    </section>
  );
}
