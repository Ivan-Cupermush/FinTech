import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { REPORT_SCHEDULE_HINTS, REPORT_SCHEDULE_LABELS, REPORT_SCHEDULES, reportSlotText, type ReportSchedule, type ReportSubscription } from '@offix/core';
import { api } from '../../lib/api';
import { Segmented } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';

const KEY = ['report-subscription'];

/** «Присылать на почту»: тот же отчёт письмом раз в неделю или раз в месяц. */
export function MailSubscription() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<ReportSubscription>('/report/subscription') });
  const save = useMutation({
    mutationFn: (s: { enabled: boolean; schedule: ReportSchedule }) => api<ReportSubscription>('/report/subscription', { method: 'PUT', body: s }),
    onMutate: async (s) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<ReportSubscription>(KEY);
      if (prev) qc.setQueryData<ReportSubscription>(KEY, { ...prev, ...s });
      return { prev };
    },
    onSuccess: (data) => qc.setQueryData(KEY, data),
    onError: (e, _s, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      toast(`Не удалось сохранить: ${(e as Error).message}`, 'error');
    },
  });
  const s = q.data;
  if (!s) return null;

  const status = !s.enabled
    ? `Тот же отчёт письмом на ${s.email}, с таблицей для Excel во вложении.`
    : s.next_at && !save.isPending
      ? `Следующее письмо — ${reportSlotText(s.next_at, new Date().toISOString())}, на ${s.email}. Таблица для Excel — во вложении.`
      : `Письма приходят на ${s.email}.`;

  return (
    <section className="card card-tight report-mail" aria-labelledby="report-mail-title">
      <label className="row" style={{ gap: 12, cursor: 'pointer' }}>
        <span className="grow stack" style={{ '--gap': '2px' } as React.CSSProperties}>
          <span id="report-mail-title" style={{ fontWeight: 600 }}>
            Присылать на почту
          </span>
          <span className="faint" style={{ fontSize: 13 }}>
            {status}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          aria-label="Присылать отчёт на почту"
          checked={s.enabled}
          onChange={(e) => save.mutate({ enabled: e.target.checked, schedule: s.schedule })}
        />
      </label>
      {s.enabled && (
        <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', rowGap: 8 }}>
          <Segmented
            label="Как часто присылать"
            value={s.schedule}
            onChange={(v) => save.mutate({ enabled: true, schedule: v })}
            options={REPORT_SCHEDULES.map((v) => ({ value: v, label: REPORT_SCHEDULE_LABELS[v] }))}
          />
          <span className="faint" style={{ fontSize: 12.5 }}>
            {REPORT_SCHEDULE_HINTS[s.schedule]}
          </span>
        </div>
      )}
      {s.enabled && !s.mail_available && (
        <p className="faint" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
          Отправка писем на сервере пока не настроена. Подписка сохранена — письма начнут приходить, когда администратор её включит.
        </p>
      )}
    </section>
  );
}
