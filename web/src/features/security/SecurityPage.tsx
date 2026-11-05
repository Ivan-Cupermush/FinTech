import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Download, Eraser, FileLock2, ShieldCheck, TriangleAlert, UserRoundX } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AUDIT_GROUP_LABELS,
  COMPANY_ROLE_LABELS,
  auditDetails,
  auditLabel,
  type AuditGroup,
  type AuditRow,
  type LoginEvent,
  type Member,
  type SecurityAdvice,
  type SecuritySummary,
} from '@offix/core';
import { api, ApiError, apiBlob, saveBlob } from '../../lib/api';
import { useMe } from '../../lib/queries';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Dialog, Empty, Segmented, Skeleton, Tabs } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { PageHero } from '../../ui/fx/PageHero';
import { isAdminRole } from '../integrations/IntegrationsPage';
import { LoginList, loginMoment } from './LoginList';
import './security.css';

type Tab = 'audit' | 'logins' | 'leavers';
const GROUPS = Object.keys(AUDIT_GROUP_LABELS) as AuditGroup[];
const ADVICE_ICON = { ok: CircleCheck, warn: TriangleAlert, bad: CircleAlert } as const;

export const sk = {
  summary: ['security', 'summary'] as const,
  audit: (g: AuditGroup) => ['security', 'audit', g] as const,
  logins: (failed: boolean) => ['security', 'logins', failed] as const,
  leavers: ['users', 'inactive'] as const,
};

/** Ушедшие, чьи данные ещё лежат: отключены, не обезличены, не владелец. */
export const leaversOf = (members: readonly Member[]) => members.filter((m) => !m.active && !m.anonymized && m.role !== 'owner');

/**
 * «Безопасность» для владельца и администратора: что происходило с
 * учётными записями, кто входил и не смог, и что сделать с данными ушедших
 * (152-ФЗ: хранить не дольше, чем нужно).
 */
export function SecurityPage() {
  const me = useMe();
  const admin = isAdminRole(me.data?.role);
  const [tab, setTab] = useState<Tab>('audit');
  const summary = useQuery({ queryKey: sk.summary, queryFn: () => api<{ summary: SecuritySummary; advice: SecurityAdvice[] }>('/security/summary'), enabled: admin });

  if (!me.data) return <div className="page"><Skeleton h={320} /></div>;
  if (!admin) {
    return (
      <div className="page" style={{ maxWidth: 860 }}>
        <PageHero variant="security" icon={ShieldCheck} compact title="Безопасность" subtitle="Журнал событий, входы и данные ушедших сотрудников." />
        <div className="card">
          <Empty icon={<ShieldCheck size={22} />} title="Раздел видят владелец и администратор">
            Свои входы и выгрузку своих данных вы найдёте в <Link to="/app/account">профиле</Link>.
          </Empty>
        </div>
      </div>
    );
  }

  const s = summary.data?.summary;
  return (
    <div className="page sec-page" style={{ maxWidth: 1000 }}>
      <PageHero
        variant="security"
        icon={ShieldCheck}
        eyebrow="152-ФЗ"
        title="Безопасность"
        subtitle="Кто что менял, кто входил и не смог, и чьи данные пора обезличить."
        stats={
          s && [
            // Три плитки — и на телефоне подписи не рвутся; о блокировках скажет красный совет ниже.
            { label: 'входов за неделю', value: s.logins_7d },
            { label: 'неудачных попыток', value: s.failures_7d, tone: s.lockouts_7d ? 'bad' : s.failures_7d ? 'warn' : undefined },
            { label: 'ждут обезличивания', value: s.to_anonymize, tone: s.to_anonymize ? 'warn' : undefined },
          ]
        }
        actions={
          <Link to="/privacy" target="_blank" className="btn btn-secondary sec-policy">
            <FileLock2 size={16} aria-hidden /> Политика обработки данных
          </Link>
        }
      />

      {summary.isLoading ? (
        <Skeleton h={64} />
      ) : (
        summary.data && (
          <ul className="sec-advice" aria-label="Советы">
            {summary.data.advice.map((a) => {
              const Icon = ADVICE_ICON[a.tone];
              return (
                <li key={a.text} className={`card sec-tip is-${a.tone}`}>
                  <Icon size={18} aria-hidden /> <span>{a.text}</span>
                </li>
              );
            })}
          </ul>
        )
      )}

      <Tabs
        label="Разделы безопасности"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'audit', label: 'Журнал событий' },
          { value: 'logins', label: 'Входы', count: s?.failures_7d || undefined },
          { value: 'leavers', label: 'Ушедшие сотрудники', count: s?.to_anonymize || undefined },
        ]}
      />
      {tab === 'audit' && <AuditPanel />}
      {tab === 'logins' && <LoginsPanel />}
      {tab === 'leavers' && <LeaversPanel />}
    </div>
  );
}

function AuditPanel() {
  const toast = useToast();
  const [group, setGroup] = useState<AuditGroup>('security');
  const [busy, setBusy] = useState(false);
  const q = useInfiniteQuery({
    queryKey: sk.audit(group),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<{ events: AuditRow[]; next: string | null }>(`/security/audit?group=${group}${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.next,
  });
  const events = q.data?.pages.flatMap((p) => p.events) ?? [];

  const download = async () => {
    setBusy(true);
    try {
      saveBlob(await apiBlob(`/security/audit?group=${group}&format=csv`), `offix-zhurnal-${group}.csv`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось скачать журнал');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card sec-panel" aria-label="Журнал событий">
      <div className="sec-panel-head">
        <Segmented label="Какие события" value={group} onChange={setGroup} options={GROUPS.map((g) => ({ value: g, label: AUDIT_GROUP_LABELS[g] }))} />
        <Button size="sm" variant="ghost" icon={<Download size={15} />} onClick={download} disabled={busy || !events.length}>
          Скачать для Excel
        </Button>
      </div>
      {q.isLoading ? (
        <Skeleton h={220} />
      ) : events.length ? (
        <ol className="sec-audit">
          {events.map((e) => {
            const details = auditDetails(e.old_values, e.new_values);
            return (
              <li key={e.id} className="sec-event">
                <Avatar name={e.actor_name ?? 'offix'} id={e.actor_id} size={32} />
                <span className="grow stack sec-event-text">
                  <span>
                    <b>{e.actor_name ?? 'Система'}</b> · {auditLabel(e.event_type)}
                    {e.target_name && e.target_name !== e.actor_name && <> · {e.target_name}</>}
                  </span>
                  {details && <span className="sec-event-details">{details}</span>}
                </span>
                <time className="faint sec-event-time" dateTime={e.at}>
                  {loginMoment(e.at)}
                </time>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="faint sec-empty">В этой группе событий пока нет</p>
      )}
      {q.hasNextPage && (
        <Button variant="ghost" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          Показать ещё
        </Button>
      )}
    </section>
  );
}

function LoginsPanel() {
  const [failed, setFailed] = useState<'all' | 'failed'>('all');
  const q = useInfiniteQuery({
    queryKey: sk.logins(failed === 'failed'),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<{ logins: LoginEvent[]; next: string | null }>(`/security/logins?${failed === 'failed' ? 'failed=1&' : ''}${pageParam ? `before=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.next,
  });
  const logins = q.data?.pages.flatMap((p) => p.logins) ?? [];
  return (
    <section className="card sec-panel" aria-label="Входы">
      <div className="sec-panel-head">
        <Segmented
          label="Какие входы"
          value={failed}
          onChange={setFailed}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'failed', label: 'Неудачные' },
          ]}
        />
        <span className="faint sec-hint">Журнал хранится 180 дней</span>
      </div>
      {q.isLoading ? <Skeleton h={220} /> : <LoginList logins={logins} who empty={failed === 'failed' ? 'Неудачных попыток не было' : 'Входов пока не было'} />}
      {q.hasNextPage && (
        <Button variant="ghost" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          Показать ещё
        </Button>
      )}
    </section>
  );
}

function LeaversPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: sk.leavers, queryFn: () => api<Member[]>('/users?include_inactive=1') });
  const [target, setTarget] = useState<Member | null>(null);
  const anonymize = useMutation({
    mutationFn: (id: string) => api<{ name: string }>(`/users/${id}/anonymize`, { method: 'POST', body: {} }),
    onSuccess: (r) => {
      toast(`Данные обезличены: теперь это «${r.name}»`);
      setTarget(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['security'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Не получилось, попробуйте ещё раз'),
  });
  const leavers = leaversOf(q.data ?? []);

  return (
    <section className="card sec-panel" aria-label="Ушедшие сотрудники">
      <p className="muted sec-lead">
        Когда сотрудник ушёл, его отключают в разделе «Организация» — войти он больше не может. Когда его данные больше не нужны, обезличьте их: имя, почта, фото, личные заметки и журнал входов удалятся, а задачи и сообщения останутся под именем «Бывший сотрудник».
      </p>
      {q.isLoading ? (
        <Skeleton h={120} />
      ) : leavers.length ? (
        <ul className="list sec-leavers">
          {leavers.map((m) => (
            <li key={m.id} className="list-row sec-leaver">
              <Avatar name={m.display_name} id={m.id} size={36} />
              <span className="grow stack" style={{ '--gap': '2px', minWidth: 0 } as React.CSSProperties}>
                <b className="clip">{m.display_name}</b>
                <span className="faint clip">
                  {COMPANY_ROLE_LABELS[m.role]}
                  {m.position ? ` · ${m.position}` : ''} · {m.email}
                </span>
              </span>
              <Button size="sm" variant="danger" icon={<Eraser size={14} />} onClick={() => setTarget(m)}>
                Обезличить
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={<UserRoundX size={22} />} title="Ушедших сотрудников с данными нет">
          Отключённые сотрудники появятся здесь.
        </Empty>
      )}
      {target && (
        <Dialog
          title={`Обезличить ${target.display_name}?`}
          onClose={() => setTarget(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setTarget(null)}>
                Отмена
              </Button>
              <Button variant="danger" icon={<Eraser size={15} />} onClick={() => anonymize.mutate(target.id)} disabled={anonymize.isPending}>
                Обезличить навсегда
              </Button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>Это нельзя отменить. Удалятся имя, почта, должность, фото, личные заметки, журнал входов и устройства для уведомлений.</p>
          <p className="faint" style={{ marginBottom: 0 }}>
            Задачи, комментарии и сообщения останутся — под именем «Бывший сотрудник», чтобы не потерять историю работы.
          </p>
        </Dialog>
      )}
    </section>
  );
}
