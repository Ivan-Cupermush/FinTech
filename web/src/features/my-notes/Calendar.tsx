import { ChevronLeft, ChevronRight } from 'lucide-react';
import { WEEKDAYS_SHORT, addMonths, monthGrid, monthTitle, plural, type CalendarCell, type MyNoteDay } from '@offix/core';

const DAY_LABEL = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Календарь заметок: точки под днями с записями, сегодня — в кольце,
 * выбранный день — залит. Стрелки листают месяцы, клавиши — дни.
 */
export function NoteCalendar({
  month,
  today,
  selected,
  days,
  onMonth,
  onSelect,
}: {
  month: string;
  today: string;
  selected: string | null;
  days: readonly MyNoteDay[];
  onMonth: (month: string) => void;
  onSelect: (date: string | null) => void;
}) {
  const total = days.reduce((s, d) => s + d.count, 0);
  return (
    <MonthCalendar
      label="Календарь заметок"
      month={month}
      today={today}
      selected={selected}
      weeks={monthGrid(month, { today, selected, counts: days })}
      summary={total ? `${total} ${plural(total, ['заметка', 'заметки', 'заметок'])}` : 'нет заметок'}
      cellLabel={(c) => (c.count ? `, заметок: ${c.count}` : '')}
      onMonth={onMonth}
      onSelect={onSelect}
    />
  );
}

/**
 * Месяц на градиенте: общий для заметок и задач. Под днём — до трёх точек по
 * числу записей; `late` — сколько из них просрочено, такие точки красные.
 */
export function MonthCalendar({
  label,
  month,
  today,
  selected,
  weeks,
  summary,
  cellLabel,
  onMonth,
  onSelect,
}: {
  label: string;
  month: string;
  today: string;
  selected: string | null;
  weeks: (CalendarCell & { late?: number })[][];
  summary: string;
  cellLabel: (c: CalendarCell & { late?: number }) => string;
  onMonth: (month: string) => void;
  onSelect: (date: string | null) => void;
}) {
  const move = (date: string, by: number) => {
    const next = new Date(Date.parse(`${date}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
    if (next.slice(0, 7) !== month) onMonth(next.slice(0, 7));
    onSelect(next);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus());
  };
  return (
    <section className="mn-cal" aria-label={label}>
      <div className="mn-cal-head">
        <button type="button" className="mn-cal-nav" onClick={() => onMonth(addMonths(month, -1))} aria-label="Предыдущий месяц">
          <ChevronLeft size={18} />
        </button>
        <div className="mn-cal-title">
          <b>{monthTitle(month)}</b>
          <span className="faint">{summary}</span>
        </div>
        <button type="button" className="mn-cal-nav" onClick={() => onMonth(addMonths(month, 1))} aria-label="Следующий месяц">
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="mn-cal-grid" role="grid" aria-label={monthTitle(month)}>
        <div className="mn-cal-row is-head" role="row">
          {WEEKDAYS_SHORT.map((d, i) => (
            <span key={d} role="columnheader" className={i >= 5 ? 'is-weekend' : ''}>
              {d}
            </span>
          ))}
        </div>
        {weeks.map((w) => (
          <div key={w[0]!.date} className="mn-cal-row" role="row">
            {w.map((c) => (
              <button
                key={c.date}
                type="button"
                role="gridcell"
                data-day={c.date}
                tabIndex={c.selected || (!selected && c.today) ? 0 : -1}
                aria-selected={c.selected}
                aria-current={c.today ? 'date' : undefined}
                aria-label={`${DAY_LABEL.format(new Date(`${c.date}T00:00:00Z`))}${cellLabel(c)}`}
                className={['mn-day', c.outside && 'is-outside', c.today && 'is-today', c.selected && 'is-selected', c.weekend && 'is-weekend', c.count && 'has-notes'].filter(Boolean).join(' ')}
                onClick={() => onSelect(c.selected ? null : c.date)}
                onKeyDown={(e) => {
                  const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
                  if (by) {
                    e.preventDefault();
                    move(c.date, by);
                  }
                }}
              >
                <span className="mn-day-num">{c.day}</span>
                {c.count > 0 && (
                  <span className="mn-day-dots" aria-hidden>
                    {Array.from({ length: Math.min(3, c.count) }, (_, i) => (
                      <i key={i} className={i < (c.late ?? 0) ? 'is-late' : undefined} />
                    ))}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
