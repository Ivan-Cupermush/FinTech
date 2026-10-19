import { formatDate } from './format';
import { formatHours } from './metrics';
import { HEALTH_LABELS, REPORT_PERIOD_LABELS, kpiLine, reportPeriodText, type GoalHealth, type Report, type ReportPeriod } from './report';
import { plural } from './units';

/**
 * Отчёт для руководства по почте. Человек подписывается на неделю или месяц,
 * сервер в назначенный час собирает тот же отчёт, что на сайте, и присылает
 * письмом: HTML как лист отчёта, текст для простых почтовых программ и CSV
 * для Excel во вложении. Здесь — расписание и сборка письма, без сети.
 */

export const REPORT_SCHEDULES = ['weekly', 'monthly'] as const;
export type ReportSchedule = (typeof REPORT_SCHEDULES)[number];

export const REPORT_SCHEDULE_LABELS: Record<ReportSchedule, string> = {
  weekly: 'Раз в неделю',
  monthly: 'Раз в месяц',
};

export const REPORT_SCHEDULE_HINTS: Record<ReportSchedule, string> = {
  weekly: 'По понедельникам в 9:00 по Москве, отчёт за неделю',
  monthly: '1-го числа в 9:00 по Москве, отчёт за месяц',
};

/** Какой период отчёта приходит по расписанию. */
export const SCHEDULE_DAYS: Record<ReportSchedule, ReportPeriod> = { weekly: 7, monthly: 30 };

export function isReportSchedule(v: unknown): v is ReportSchedule {
  return (REPORT_SCHEDULES as readonly unknown[]).includes(v);
}

export interface ReportSubscription {
  enabled: boolean;
  schedule: ReportSchedule;
  /** Куда придёт письмо: почта, с которой человек входит. */
  email: string;
  last_sent_at: string | null;
  /** Когда придёт следующее письмо; null — подписка выключена. */
  next_at: string | null;
  /** Отправка писем настроена на сервере. Иначе подписка сохраняется, но писем нет. */
  mail_available: boolean;
}

/** Отчёт приходит в 9:00 по Москве (UTC+3, без перехода на летнее время) = 06:00 UTC. */
export const REPORT_SEND_HOUR_MSK = 9;
const MSK_OFFSET_HOURS = 3;
const SEND_HOUR_UTC = REPORT_SEND_HOUR_MSK - MSK_OFFSET_HOURS;
const DAY_MS = 86_400_000;

/** Последний момент отправки по расписанию, не позже `at`. */
export function lastReportSlot(schedule: ReportSchedule, at: string): string {
  const t = new Date(at).getTime();
  // Дата по Москве: сдвигаем на +3 ч и берём календарный день в UTC.
  const msk = new Date(t + MSK_OFFSET_HOURS * 3_600_000);
  let slot: number;
  if (schedule === 'weekly') {
    const sinceMonday = (msk.getUTCDay() + 6) % 7;
    slot = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() - sinceMonday, SEND_HOUR_UTC);
    if (slot > t) slot -= 7 * DAY_MS;
  } else {
    slot = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), 1, SEND_HOUR_UTC);
    if (slot > t) slot = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth() - 1, 1, SEND_HOUR_UTC);
  }
  return new Date(slot).toISOString();
}

/** Следующий момент отправки строго после `at`. */
export function nextReportSlot(schedule: ReportSchedule, at: string): string {
  const last = new Date(lastReportSlot(schedule, at));
  const next = schedule === 'weekly' ? new Date(last.getTime() + 7 * DAY_MS) : new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1, SEND_HOUR_UTC));
  return next.toISOString();
}

/**
 * Пора ли слать. `since` — когда отправили в последний раз, а если ещё ни
 * разу — когда включили подписку. Шлём один раз за каждый момент расписания:
 * включили во вторник — первое письмо в следующий понедельник, а не сразу.
 */
export function isReportDue(schedule: ReportSchedule, since: string, at: string): boolean {
  return lastReportSlot(schedule, at) > since;
}

/** «понедельник, 26 октября, 9:00» — для подписи под переключателем. */
export function reportSlotText(iso: string, today: string): string {
  const msk = new Date(new Date(iso).getTime() + MSK_OFFSET_HOURS * 3_600_000);
  const day = msk.toISOString().slice(0, 10);
  const weekday = WEEKDAYS[msk.getUTCDay()]!;
  return `${weekday}, ${formatDate(day, { today })}, ${msk.getUTCHours()}:${String(msk.getUTCMinutes()).padStart(2, '0')}`;
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

// ——— Письмо ———

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** «Отчёт offix · Демо-университет · неделя, 12 — 19 октября 2026». */
export function reportMailSubject(r: Report): string {
  return `Отчёт offix · ${r.company} · ${REPORT_PERIOD_LABELS[r.days].toLowerCase()}, ${reportPeriodText(r)}`.replace(/ /g, ' ');
}

/** Цвета листа отчёта: почтовые программы не знают CSS-переменных и тёмной темы. */
const C = {
  bg: '#F6F6F3',
  paper: '#FFFFFF',
  ink: '#0B0B0F',
  ink2: '#4A4A55',
  ink3: '#8A8A96',
  line: '#E4E4DD',
  accent: '#3B5BFF',
  bad: '#E0464C',
  badSoft: '#FDE8E8',
  warn: '#D97A00',
  warnSoft: '#FFF1DC',
  good: '#12A36A',
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

const HEALTH_COLOR: Record<GoalHealth, string> = { critical: C.bad, warning: C.warn, blind: C.ink3, ok: C.accent, done: C.good };

/**
 * HTML письма: одна колонка 600 px на таблицах и встроенных стилях — так
 * письмо одинаково выглядит в Gmail, Outlook и почте на телефоне. Весь текст
 * из данных экранируется. `appUrl` — адрес сайта для ссылок на цели и отчёт.
 */
export function reportMailHtml(r: Report, opts: { appUrl?: string } = {}): string {
  const e = escapeHtml;
  const base = opts.appUrl?.replace(/\/+$/, '');
  const h = r.headline;
  const p: string[] = [];
  const h2 = (t: string) => `<h2 style="margin:28px 0 10px;font-size:12px;line-height:16px;letter-spacing:.06em;text-transform:uppercase;color:${C.ink3};font-weight:600">${e(t)}</h2>`;

  p.push(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px"><tr>`,
    `<td style="font-size:17px;line-height:22px;font-weight:700;color:${C.ink}">${e(r.company)}</td>`,
    `<td align="right" style="font-size:13px;line-height:18px;color:${C.ink2}">${e(reportPeriodText(r))}</td>`,
    `</tr><tr>`,
    `<td style="font-size:13px;line-height:18px;color:${C.ink3}">${r.scope === 'visible' ? 'Цели вашей зоны' : 'Вся организация'} · ${e(REPORT_PERIOD_LABELS[r.days].toLowerCase())}</td>`,
    `<td align="right" style="font-size:13px;line-height:18px;color:${C.ink3}">Сформирован ${e(formatDate(r.at, { today: '0000' }))}</td>`,
    `</tr></table>`,
  );

  if (h.goals === 0) {
    p.push(`<p style="margin:24px 0;font-size:15px;line-height:22px;color:${C.ink2}">За период нет целей в работе. Запущенные и завершённые цели появятся в отчёте сами.</p>`);
  } else {
    if (r.summary.length) {
      p.push(h2('Главное'));
      p.push(`<ul style="margin:0;padding:0 0 0 18px">${r.summary.map((s) => `<li style="margin:0 0 6px;font-size:15px;line-height:22px;color:${C.ink}">${e(s)}</li>`).join('')}</ul>`);
    }

    const figures: { label: string; value: string; note: string; bad?: boolean }[] = [
      { label: 'Цели сдвинули KPI', value: h.north_star === null ? '—' : `${h.north_star} %`, note: h.with_kpi ? `${h.improved} из ${h.with_kpi} с KPI` : 'нет целей с KPI' },
      { label: 'Под угрозой', value: String(h.health.critical), note: `из ${h.goals} ${plural(h.goals, ['цели', 'целей', 'целей'])}`, bad: h.health.critical > 0 },
      { label: 'Закрыто задач', value: String(h.tasks_done), note: h.on_time === null ? 'без сроков' : `${h.on_time} % в срок` },
      { label: 'Снятие блокера', value: formatHours(h.blocker_median_hours), note: h.open_blockers ? `${h.open_blockers} ${plural(h.open_blockers, ['открыт', 'открыто', 'открыто'])} сейчас` : 'открытых нет' },
    ];
    p.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-collapse:separate;border-spacing:0"><tr>`,
      figures
        .map(
          (f, i) =>
            `<td width="25%" valign="top" style="padding:12px ${i === 3 ? 0 : 12}px 12px ${i ? 12 : 0}px;border-top:1px solid ${C.line}">` +
            `<div style="font-size:12px;line-height:16px;color:${C.ink3}">${e(f.label)}</div>` +
            `<div style="margin-top:4px;font-size:24px;line-height:28px;font-weight:700;color:${f.bad ? C.bad : C.ink}">${e(f.value)}</div>` +
            `<div style="margin-top:2px;font-size:12px;line-height:16px;color:${C.ink3}">${e(f.note)}</div></td>`,
        )
        .join(''),
      `</tr></table>`,
    );

    if (r.decisions.length) {
      p.push(h2('Нужно решение'));
      for (const [i, d] of r.decisions.entries()) {
        const critical = d.severity === 'critical';
        p.push(
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;background:${critical ? C.badSoft : C.warnSoft};border-radius:12px"><tr>`,
          `<td width="28" valign="top" style="padding:12px 0 12px 14px;font-size:14px;line-height:20px;font-weight:700;color:${critical ? C.bad : C.warn}">${i + 1}</td>`,
          `<td style="padding:12px 14px 12px 6px">`,
          `<div style="font-size:15px;line-height:21px;font-weight:600;color:${C.ink}">${e(d.title)}</div>`,
          `<div style="font-size:13px;line-height:18px;color:${C.ink3}">${e(d.goal_title)}</div>`,
          d.explanation ? `<div style="margin-top:4px;font-size:14px;line-height:20px;color:${C.ink2}">${e(d.explanation)}</div>` : '',
          `<div style="margin-top:4px;font-size:14px;line-height:20px;color:${C.ink}">→ ${e(d.suggestion)}</div>`,
          `</td></tr></table>`,
        );
      }
    }

    p.push(h2('Цели'));
    for (const g of r.goals) {
      const title = base ? `<a href="${e(`${base}/app/goals/${encodeURIComponent(g.id)}`)}" style="color:${C.ink};text-decoration:none">${e(g.title)}</a>` : e(g.title);
      const meta = [g.owner, g.health === 'done' && g.completed_at ? `завершена ${formatDate(g.completed_at, { today: r.at })}` : g.due_at ? `срок ${formatDate(g.due_at, { today: r.at })}` : null].filter(Boolean).join(' · ');
      const kpi = g.kpi ? `${g.kpi.name}: ${kpiLine(g.kpi)}${g.kpi.progress !== null && g.kpi.direction !== 'maintain' ? ` · ${g.kpi.progress} % пути` : ''}` : 'Без KPI: эффект не измерить';
      p.push(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.line}"><tr>`,
        `<td style="padding:12px 0">`,
        `<div style="font-size:15px;line-height:21px;font-weight:600;color:${C.ink}">${title}</div>`,
        meta ? `<div style="font-size:13px;line-height:18px;color:${C.ink3}">${e(meta)}</div>` : '',
        `<div style="margin-top:4px;font-size:14px;line-height:20px;color:${C.ink2}">${e(kpi)}</div>`,
        `</td>`,
        `<td align="right" valign="top" style="padding:12px 0 12px 12px;white-space:nowrap;font-size:13px;line-height:21px;font-weight:600;color:${HEALTH_COLOR[g.health]}">${e(HEALTH_LABELS[g.health])}</td>`,
        `</tr></table>`,
      );
    }
  }

  const link = base ? ` <a href="${e(`${base}/app/report?days=${r.days}`)}" style="color:${C.ink2}">Открыть отчёт на сайте</a>.` : '';
  p.push(
    `<p style="margin:28px 0 0;padding-top:14px;border-top:1px solid ${C.line};font-size:12px;line-height:18px;color:${C.ink3}">` +
      `Данные offix: замеры KPI, история задач и журнал целей. Таблица для Excel — во вложении.${link}<br>` +
      `Письмо пришло, потому что вы подписались на отчёт. Отключить можно на странице «Отчёт».</p>`,
  );

  return [
    '<!doctype html>',
    '<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<meta name="color-scheme" content="light"><title>${e(reportMailSubject(r))}</title></head>`,
    `<body style="margin:0;padding:0;background:${C.bg}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">`,
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${C.paper};border:1px solid ${C.line};border-radius:20px"><tr>`,
    `<td style="padding:28px 28px 24px;font-family:${FONT};color:${C.ink}">`,
    p.join(''),
    '</td></tr></table>',
    '</td></tr></table>',
    '</body></html>',
  ].join('');
}
