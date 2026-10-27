import { ChevronLeft, ChevronRight, NotebookPen, Paperclip, Star } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { WEEKDAYS_SHORT, addMonths, monthGrid, monthTitle, noteDayLabel, noteTitle, plural, type MyNoteDay, type MyNoteSummary, type NoteShareCard } from '@offix/core';
import { font, usePalette } from '../lib/theme';
import { Glass } from './fx/Glass';
import { GradientBackdrop } from './fx/GradientBackdrop';
import { Text } from './primitives';

const DAY_LABEL = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * Календарь заметок на градиенте раздела: точки под днями с записями,
 * сегодня — в кольце, выбранный день — белый. Стрелки листают месяцы.
 */
export function NoteCalendar({ month, today, selected, days, onMonth, onSelect }: { month: string; today: string; selected: string | null; days: readonly MyNoteDay[]; onMonth: (m: string) => void; onSelect: (d: string | null) => void }) {
  const weeks = monthGrid(month, { today, selected, counts: days });
  const total = days.reduce((s, d) => s + d.count, 0);
  const nav = (by: number, label: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onMonth(addMonths(month, by))} hitSlop={8}>
      <Glass radius={16} style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
        {by < 0 ? <ChevronLeft size={18} color="#fff" /> : <ChevronRight size={18} color="#fff" />}
      </Glass>
    </Pressable>
  );
  return (
    <View style={{ borderRadius: 28, overflow: 'hidden', backgroundColor: '#08162a' }}>
      <GradientBackdrop variant="notes" />
      <View style={{ padding: 10 }}>
        <Glass radius={22}>
          <View accessibilityLabel="Календарь заметок" style={{ padding: 12, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {nav(-1, 'Предыдущий месяц')}
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontFamily: font.semibold, fontSize: 16 }}>{monthTitle(month)}</Text>
                <Text variant="caption" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  {total ? `${total} ${plural(total, ['заметка', 'заметки', 'заметок'])}` : 'нет заметок'}
                </Text>
              </View>
              {nav(1, 'Следующий месяц')}
            </View>
            <View style={{ flexDirection: 'row' }}>
              {WEEKDAYS_SHORT.map((d, i) => (
                <Text key={d} variant="caption" style={{ flex: 1, textAlign: 'center', color: i >= 5 ? 'rgba(255,214,170,0.85)' : 'rgba(255,255,255,0.6)' }}>
                  {d}
                </Text>
              ))}
            </View>
            {weeks.map((w) => (
              <View key={w[0]!.date} style={{ flexDirection: 'row' }}>
                {w.map((c) => (
                  <Pressable
                    key={c.date}
                    accessibilityRole="button"
                    accessibilityState={{ selected: c.selected }}
                    accessibilityLabel={`${DAY_LABEL.format(new Date(`${c.date}T00:00:00Z`))}${c.today ? ', сегодня' : ''}${c.count ? `, заметок: ${c.count}` : ''}`}
                    onPress={() => onSelect(c.selected ? null : c.date)}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 2 }}
                  >
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 19,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: c.selected ? '#fff' : 'transparent',
                        borderWidth: c.today && !c.selected ? 1.5 : 0,
                        borderColor: 'rgba(255,255,255,0.85)',
                      }}
                    >
                      <Text style={{ fontSize: 15, fontFamily: c.selected || c.today ? font.semibold : font.regular, color: c.selected ? '#141625' : c.outside ? 'rgba(255,255,255,0.32)' : '#fff' }}>{c.day}</Text>
                      {c.count > 0 && (
                        <View style={{ position: 'absolute', bottom: 4, flexDirection: 'row', gap: 2 }}>
                          {Array.from({ length: Math.min(3, c.count) }, (_, i) => (
                            <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c.selected ? '#3352ff' : '#c6f07f' }} />
                          ))}
                        </View>
                      )}
                    </View>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        </Glass>
      </View>
    </View>
  );
}

/** Строка заметки: дата плиткой, заголовок, отрывок и звёздочка. */
export function NoteRow({ n, today, onPress, onFavorite }: { n: MyNoteSummary; today: string; onPress: () => void; onFavorite?: () => void }) {
  const p = usePalette();
  const label = noteDayLabel(n.note_date, today);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 20, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${noteTitle(n.title)}, ${label}`} onPress={onPress} style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.7 : 1 })}>
        <View style={{ width: 46, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accentSoft }}>
          <Text style={{ fontFamily: font.bold, fontSize: 18, lineHeight: 20, color: p.accent }}>{Number(n.note_date.slice(8))}</Text>
          <Text variant="caption" style={{ color: p.accent }}>
            {label.replace(/^\d+ /, '').slice(0, 3)}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ fontFamily: font.semibold }}>
            {noteTitle(n.title)}
          </Text>
          {!!n.excerpt && (
            <Text variant="small" tone="muted" numberOfLines={2}>
              {n.excerpt}
            </Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text variant="caption" tone="faint">
              {label}
            </Text>
            {n.files_count > 0 && (
              <>
                <Paperclip size={11} color={p.ink3} />
                <Text variant="caption" tone="faint">
                  {n.files_count}
                </Text>
              </>
            )}
          </View>
        </View>
      </Pressable>
      {onFavorite && (
        <Pressable accessibilityRole="button" accessibilityLabel={n.is_favorite ? 'Убрать из избранного' : 'В избранное'} accessibilityState={{ selected: n.is_favorite }} onPress={onFavorite} hitSlop={10}>
          <Star size={20} color={n.is_favorite ? '#f5b301' : p.ink3} fill={n.is_favorite ? '#f5b301' : 'none'} />
        </Pressable>
      )}
    </View>
  );
}

/** Заметка в пузыре чата: снимок с названием, отрывком и числом файлов. */
export function NoteShareBubble({ note, mine, ink, soft, onOpen }: { note: NoteShareCard; mine: boolean; ink: string; soft: string; onOpen: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Заметка «${noteTitle(note.title)}» — открыть`}
      onPress={onOpen}
      style={({ pressed }) => ({ minWidth: 220, gap: 6, padding: 10, borderRadius: 14, backgroundColor: mine ? 'rgba(255,255,255,0.16)' : 'rgba(51,82,255,0.08)', borderWidth: 1, borderColor: mine ? 'rgba(255,255,255,0.25)' : 'rgba(51,82,255,0.18)', opacity: pressed ? 0.75 : 1 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: mine ? 'rgba(255,255,255,0.22)' : '#3352ff' }}>
          <NotebookPen size={16} color="#fff" />
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text numberOfLines={1} style={{ color: ink, fontFamily: font.semibold, fontSize: 15 }}>
            {noteTitle(note.title)}
          </Text>
          <Text style={{ color: soft, fontSize: 12 }}>{note.files_count ? `Заметка · файлов: ${note.files_count}` : 'Заметка'}</Text>
        </View>
      </View>
      {!!note.excerpt && (
        <Text numberOfLines={3} style={{ color: soft, fontSize: 13.5, lineHeight: 19 }}>
          {note.excerpt}
        </Text>
      )}
    </Pressable>
  );
}
