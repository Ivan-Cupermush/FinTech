import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PUSH_TOPIC_LABELS, PUSH_TOPICS, QUIET_FROM_HOUR, QUIET_TO_HOUR, plural, type PushSettings as Settings, type PushTopic } from '@offix/core';
import { api } from '../../lib/api';
import { Skeleton } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';

type Loaded = Settings & { devices: number };
const KEY = ['push-settings'];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/**
 * Push на телефон: те же темы и тихие часы, что в приложении. Сами
 * уведомления на этой странице остаются всегда — здесь только то, что будит телефон.
 */
export function PushSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<Loaded>('/push/settings') });
  const save = useMutation({
    mutationFn: (s: Settings) => api<Settings>('/push/settings', { method: 'PUT', body: s }),
    onMutate: async (s) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Loaded>(KEY);
      if (prev) qc.setQueryData<Loaded>(KEY, { ...prev, ...s });
      return { prev };
    },
    onError: (e, _s, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      toast(`Не удалось сохранить: ${(e as Error).message}`, 'error');
    },
  });
  const s = q.data;
  const set = (patch: Partial<Settings>) => s && save.mutate({ muted: patch.muted ?? s.muted, quiet_hours: patch.quiet_hours ?? s.quiet_hours });
  const toggle = (t: PushTopic, on: boolean) => s && set({ muted: on ? s.muted.filter((m) => m !== t) : [...s.muted, t] });

  return (
    <section aria-labelledby="push-title">
      <div className="eyebrow" id="push-title" style={{ marginBottom: 8 }}>
        Push на телефоне
      </div>
      {q.isLoading ? (
        <Skeleton h={160} />
      ) : q.isError || !s ? (
        <div className="card card-tight faint">Настройки push сейчас недоступны.</div>
      ) : (
        <div className="card card-tight">
          <div className="list">
            {PUSH_TOPICS.map((t) => (
              <Row key={t} title={PUSH_TOPIC_LABELS[t].title} hint={PUSH_TOPIC_LABELS[t].hint} checked={!s.muted.includes(t)} onChange={(on) => toggle(t, on)} />
            ))}
            <Row title={`Тихие часы ${hh(QUIET_FROM_HOUR)}–${hh(QUIET_TO_HOUR)}`} hint="Ночью push не приходят, кроме блокеров. Всё остальное ждёт здесь." checked={s.quiet_hours} onChange={(on) => set({ quiet_hours: on })} />
          </div>
          <p className="faint" style={{ fontSize: 12.5, margin: '8px 4px 0' }}>
            {s.devices
              ? `Push приходят на ${s.devices} ${plural(s.devices, ['устройство', 'устройства', 'устройств'])}.`
              : 'Телефон ещё не привязан: включите уведомления во «Входящих» в приложении offix.'}
          </p>
        </div>
      )}
    </section>
  );
}

function Row({ title, hint, checked, onChange }: { title: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="list-row" style={{ cursor: 'pointer' }}>
      <span className="grow stack" style={{ '--gap': '2px' } as React.CSSProperties}>
        <span>{title}</span>
        <span className="faint" style={{ fontSize: 13 }}>
          {hint}
        </span>
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
