import { Check, Minus, ShieldCheck } from 'lucide-react';
import { functionWhereText, type DelegableFunction } from '@offix/core';
import { ApiError } from '../../lib/api';
import { Skeleton } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { useMyFunctions, useSetFunctions, useUserFunctions, type FunctionsView } from './data';
import '../tasks/tasks.css';

function FunctionList({ view, onChange, busy }: { view: FunctionsView; onChange?: (key: DelegableFunction, value: boolean | null) => void; busy?: boolean }) {
  return (
    <div className="fn-list">
      {view.functions.map((f) => (
        <div key={f.key} className="fn-row">
          <div className="fn-text">
            <b>{f.label}</b>
            <span className="faint">{f.hint}</span>
            <span style={{ color: f.enabled ? 'var(--good)' : 'var(--ink-3)' }}>{functionWhereText(f)}</span>
            {onChange && f.override !== null && !f.locked && (
              <button type="button" className="fn-reset" disabled={busy} onClick={() => onChange(f.key, null)}>
                {f.default ? 'Вернуть по должности — включено' : 'Вернуть по должности — выключено'}
              </button>
            )}
          </div>
          {onChange ? (
            <button
              type="button"
              className="fn-switch"
              role="switch"
              aria-checked={f.enabled}
              aria-label={f.label}
              disabled={busy || f.locked}
              onClick={() => onChange(f.key, !f.enabled)}
            />
          ) : f.enabled ? (
            <Check size={18} style={{ color: 'var(--good)', flex: 'none' }} aria-label="Включено" />
          ) : (
            <Minus size={18} className="faint" style={{ flex: 'none' }} aria-label="Выключено" />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Функции коллеги на его карточке. Руководитель включает своим подчинённым
 * то, что умеет сам; администратор — любому. Остальным карточка не видна.
 */
export function PersonFunctions({ userId, name }: { userId: string; name: string }) {
  const q = useUserFunctions(userId);
  const set = useSetFunctions(userId);
  const toast = useToast();
  if (q.isError || (q.data && !q.data.can_change && !q.data.functions.some((f) => f.enabled))) return null;
  const change = (key: DelegableFunction, value: boolean | null) =>
    set.mutate(
      { [key]: value },
      {
        onSuccess: () => toast(value === null ? 'Вернули как по должности' : value ? `${name.split(' ')[0]} узнает, что функцию включили` : 'Функция отключена'),
        onError: (e) => toast(e instanceof ApiError ? e.message : 'Не получилось, попробуйте ещё раз', 'error'),
      },
    );
  return (
    <section className="card acc-card" aria-labelledby="person-fn">
      <h2 id="person-fn" className="acc-h">
        <ShieldCheck size={18} aria-hidden /> Функции
      </h2>
      {q.isLoading || !q.data ? (
        <Skeleton h={120} />
      ) : (
        <>
          <p className="faint acc-note">
            {q.data.can_change ? 'Включите сотруднику то, что он будет делать вместо вас. Он узнает об этом во «Входящих».' : (q.data.reason ?? 'Менять функции может руководитель сотрудника.')}
          </p>
          <FunctionList view={q.data} onChange={q.data.can_change ? change : undefined} busy={set.isPending} />
        </>
      )}
    </section>
  );
}

/** «Мои функции» в профиле: что мне включено и почему. */
export function MyFunctions() {
  const q = useMyFunctions();
  if (q.isError) return null;
  return (
    <section className="card acc-card" aria-labelledby="acc-fn">
      <h2 id="acc-fn" className="acc-h">
        <ShieldCheck size={18} aria-hidden /> Мои функции
      </h2>
      {q.data ? (
        <>
          <p className="faint acc-note">Что вы можете делать сверх обычной работы. Включает и отключает руководитель.</p>
          <FunctionList view={q.data} />
        </>
      ) : (
        <Skeleton h={120} />
      )}
    </section>
  );
}
