import { Check, CheckCheck, Clock, Forward, Pin, RotateCcw } from 'lucide-react-native';
import { memo, useId } from 'react';
import { Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { moscowTime, type ChatMessage, type ChatPoll } from '@offix/core';
import { wallpaperColors } from '../lib/chat-logic';
import { font, usePalette } from '../lib/theme';
import { Avatar, Text } from './primitives';

const HUES = [228, 262, 160, 28, 340, 196, 48, 290];
const hueOf = (s: string) => HUES[[...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0) % HUES.length]!;
const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Аватар чата: у группы — плитка с переливом своего цвета, у человека — кружок и точка «в сети». */
export function ChatAvatar({ title, group, online, size = 52, icon }: { title: string; group: boolean; online?: boolean; size?: number; icon?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const p = usePalette();
  if (!group) {
    return (
      <View style={{ width: size, height: size }}>
        <Avatar name={title} size={size} />
        {online && <View accessibilityLabel="в сети" style={{ position: 'absolute', right: 0, bottom: 0, width: size * 0.28, height: size * 0.28, borderRadius: size, backgroundColor: p.good, borderWidth: 2.5, borderColor: p.bg }} />}
      </View>
    );
  }
  const h = hueOf(title);
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`a${uid}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={`hsl(${h}, 90%, 66%)`} />
            <Stop offset="1" stopColor={`hsl(${(h + 40) % 360}, 85%, 52%)`} />
          </LinearGradient>
          <RadialGradient id={`s${uid}`} cx="25%" cy="15%" r="70%">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#a${uid})`} />
        <Rect width="100%" height="100%" fill={`url(#s${uid})`} />
      </Svg>
      <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: icon ? size * 0.46 : size * 0.36 }}>{icon ?? initials(title)}</Text>
    </View>
  );
}

/** Обои переписки: живой градиент раздела и редкая сетка точек — стеклу пузырей есть что размывать. */
export function Wallpaper() {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const dark = useColorScheme() === 'dark';
  const [a, b, c] = wallpaperColors(dark ? 'dark' : 'light');
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={`b${uid}`} x1="0" y1="0" x2="0.4" y2="1">
            <Stop offset="0" stopColor={a} />
            <Stop offset="0.62" stopColor={b} />
            <Stop offset="1" stopColor={b} />
          </LinearGradient>
          <RadialGradient id={`g${uid}`} cx="88%" cy="34%" r="60%">
            <Stop offset="0" stopColor={c} stopOpacity={dark ? 0.55 : 0.75} />
            <Stop offset="1" stopColor={c} stopOpacity={0} />
          </RadialGradient>
          <Pattern id={`d${uid}`} width="22" height="22" patternUnits="userSpaceOnUse">
            <Circle cx="2" cy="2" r="1.1" fill={dark ? '#ffffff' : '#1b2142'} opacity={dark ? 0.12 : 0.1} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#b${uid})`} />
        <Rect width="100%" height="100%" fill={`url(#g${uid})`} />
        <Rect width="100%" height="100%" fill={`url(#d${uid})`} />
      </Svg>
    </View>
  );
}

/** Цвета ленты поверх обоев: свои пузыри — фирменный синий, чужие — матовое стекло. */
export function useWall() {
  const dark = useColorScheme() === 'dark';
  return dark
    ? { ink: '#e8eaff', inkSoft: 'rgba(232,234,255,0.66)', bubbleIn: 'rgba(23,24,38,0.84)', bubbleInLine: 'rgba(255,255,255,0.09)', pill: 'rgba(12,14,36,0.62)', pillLine: 'rgba(255,255,255,0.1)', out: '#4a5ff2', outLine: 'rgba(255,255,255,0.18)', name: (h: number) => `hsl(${h}, 85%, 76%)` }
    : { ink: '#11152e', inkSoft: 'rgba(17,21,46,0.6)', bubbleIn: 'rgba(255,255,255,0.88)', bubbleInLine: 'rgba(255,255,255,0.9)', pill: 'rgba(255,255,255,0.7)', pillLine: 'rgba(255,255,255,0.9)', out: '#3b5bff', outLine: 'rgba(255,255,255,0.25)', name: (h: number) => `hsl(${h}, 62%, 42%)` };
}

/** Плашка на обоях: день, служебное сообщение, «Новые». */
export function WallPill({ text, accent }: { text: string; accent?: boolean }) {
  const w = useWall();
  return (
    <View style={{ alignSelf: 'center', marginVertical: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: accent ? w.out : w.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: accent ? w.outLine : w.pillLine, maxWidth: '86%' }}>
      <Text style={{ color: accent ? '#fff' : w.ink, fontSize: 12.5, fontFamily: font.semibold, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}

function Ticks({ m }: { m: ChatMessage & { failed?: boolean } }) {
  const color = 'rgba(255,255,255,0.85)';
  if (m.failed) return null;
  if (m.id.startsWith('local-')) return <Clock size={12} color={color} accessibilityLabel="Отправляется" />;
  return m.read ? <CheckCheck size={14} color="#9ef0ff" accessibilityLabel="Прочитано" /> : <Check size={14} color={color} accessibilityLabel="Отправлено" />;
}

/**
 * Пузырь сообщения. Касание — меню действий (ответ, реакция, закреп, правка,
 * удаление), долгое касание — сразу палитра реакций, как в привычных мессенджерах.
 */
export const Bubble = memo(function Bubble({
  m,
  mine,
  group,
  first,
  last,
  onPress,
  onLongPress,
  onReact,
  onJump,
  onVote,
  onRetry,
}: {
  m: ChatMessage & { failed?: boolean };
  mine: boolean;
  group: boolean;
  first: boolean;
  last: boolean;
  onPress: (m: ChatMessage) => void;
  onLongPress: (m: ChatMessage) => void;
  onReact: (m: ChatMessage, emoji: string) => void;
  onJump: (id: string) => void;
  onVote: (m: ChatMessage, optionId: string) => void;
  onRetry: (m: ChatMessage) => void;
}) {
  const w = useWall();
  if (m.kind === 'service') return <WallPill text={m.text ?? ''} />;
  const name = m.sender_name ?? 'Удалённый аккаунт';
  const ink = mine ? '#fff' : w.ink;
  const soft = mine ? 'rgba(255,255,255,0.75)' : w.inkSoft;
  const r = 20;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: mine ? 'flex-end' : 'flex-start', gap: 8, marginTop: first ? 8 : 2 }}>
      {group && !mine && <View style={{ width: 32 }}>{last && <Avatar name={name} size={32} />}</View>}
      <View style={{ maxWidth: '80%', gap: 4, alignItems: mine ? 'flex-end' : 'flex-start' }}>
        <Pressable
          onPress={() => onPress(m)}
          onLongPress={() => onLongPress(m)}
          delayLongPress={320}
          accessibilityRole="button"
          accessibilityLabel={`${mine ? 'Вы' : name}: ${m.poll ? `опрос «${m.poll.question}»` : (m.text ?? '')}, ${moscowTime(m.created_at)}`}
          accessibilityHint="Касание — действия, долгое касание — реакция"
          style={({ pressed }) => ({
            minWidth: 72,
            paddingHorizontal: 12,
            paddingTop: 7,
            paddingBottom: 6,
            borderRadius: r,
            borderBottomRightRadius: mine && last ? 6 : r,
            borderBottomLeftRadius: !mine && last ? 6 : r,
            backgroundColor: mine ? w.out : w.bubbleIn,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: mine ? w.outLine : w.bubbleInLine,
            shadowColor: mine ? '#2f4bff' : '#10185a',
            shadowOpacity: mine ? 0.35 : 0.16,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
            elevation: 2,
            transform: [{ scale: pressed ? 0.98 : 1 }],
            opacity: m.failed ? 0.7 : 1,
          })}
        >
          {group && !mine && first && <Text style={{ color: w.name(hueOf(name)), fontFamily: font.semibold, fontSize: 13, marginBottom: 2 }}>{name}</Text>}
          {m.forwarded_from && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <Forward size={12} color={soft} />
              <Text style={{ color: soft, fontSize: 12.5 }} numberOfLines={1}>
                Переслано от {m.forwarded_from.sender_name ?? 'удалённого аккаунта'}
              </Text>
            </View>
          )}
          {m.reply_to && (
            <Pressable onPress={() => onJump(m.reply_to!.id)} accessibilityRole="button" accessibilityLabel={`Ответ на сообщение ${m.reply_to.sender_name ?? ''}`} style={{ marginBottom: 4, paddingVertical: 4, paddingHorizontal: 8, borderLeftWidth: 3, borderLeftColor: mine ? 'rgba(255,255,255,0.85)' : w.name(hueOf(m.reply_to.sender_name ?? '')), borderRadius: 8, backgroundColor: mine ? 'rgba(255,255,255,0.16)' : 'rgba(59,91,255,0.08)' }}>
              <Text style={{ color: mine ? '#fff' : w.name(hueOf(m.reply_to.sender_name ?? '')), fontFamily: font.semibold, fontSize: 12.5 }} numberOfLines={1}>
                {m.reply_to.sender_name ?? 'Удалённый аккаунт'}
              </Text>
              <Text style={{ color: soft, fontSize: 13 }} numberOfLines={1}>
                {m.reply_to.deleted ? 'Сообщение удалено' : m.reply_to.text}
              </Text>
            </Pressable>
          )}
          {m.poll ? <PollCard poll={m.poll} ink={ink} soft={soft} onVote={(o) => onVote(m, o)} /> : <Text style={{ color: ink, fontSize: 16, lineHeight: 22 }}>{m.text}</Text>}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2 }}>
            {m.pinned && <Pin size={11} color={soft} />}
            {m.edited_at && <Text style={{ color: soft, fontSize: 11 }}>изменено</Text>}
            <Text style={{ color: soft, fontSize: 11, fontVariant: ['tabular-nums'] }}>{moscowTime(m.created_at)}</Text>
            {mine && <Ticks m={m} />}
          </View>
        </Pressable>
        {m.reactions.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {m.reactions.map((x) => (
              <Pressable
                key={x.emoji}
                onPress={() => onReact(m, x.emoji)}
                accessibilityRole="button"
                accessibilityLabel={`${x.emoji} ${x.count}${x.mine ? ', ваша реакция' : ''}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 28, borderRadius: 14, backgroundColor: x.mine ? w.out : w.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: x.mine ? w.outLine : w.pillLine }}
              >
                <Text style={{ fontSize: 14 }}>{x.emoji}</Text>
                <Text style={{ color: x.mine ? '#fff' : w.ink, fontFamily: font.semibold, fontSize: 12.5 }}>{x.count}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {m.failed && (
          <Pressable onPress={() => onRetry(m)} accessibilityRole="button" accessibilityLabel="Не отправлено. Повторить" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: w.pill }}>
            <RotateCcw size={13} color="#e0464c" />
            <Text style={{ color: '#e0464c', fontSize: 12.5, fontFamily: font.semibold }}>Не отправлено · Повторить</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
});

/** Опрос в пузыре: до голоса — варианты, после — полосы с процентами. */
function PollCard({ poll, ink, soft, onVote }: { poll: ChatPoll; ink: string; soft: string; onVote: (optionId: string) => void }) {
  const results = poll.voted || poll.closed;
  return (
    <View style={{ gap: 8, minWidth: 220 }}>
      <Text style={{ color: ink, fontFamily: font.semibold, fontSize: 16, lineHeight: 21 }}>{poll.question}</Text>
      <Text style={{ color: soft, fontSize: 12.5 }}>
        {poll.quiz ? 'Викторина' : poll.anonymous ? 'Анонимный опрос' : 'Открытый опрос'}
        {poll.closed ? ' · закрыт' : ''}
      </Text>
      {poll.options.map((o) => {
        const pct = poll.total_voters ? Math.round((o.votes / poll.total_voters) * 100) : 0;
        return (
          <Pressable
            key={o.id}
            disabled={results}
            onPress={() => onVote(o.id)}
            accessibilityRole={results ? 'text' : 'radio'}
            accessibilityState={{ checked: o.voted }}
            accessibilityLabel={results ? `${o.text}: ${pct}%` : o.text}
            style={({ pressed }) => ({ minHeight: 40, borderRadius: 12, overflow: 'hidden', justifyContent: 'center', paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(127,127,160,0.35)', backgroundColor: pressed ? 'rgba(127,127,160,0.18)' : 'rgba(255,255,255,0.08)' })}
          >
            {results && <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, backgroundColor: o.voted ? 'rgba(59,91,255,0.35)' : 'rgba(127,127,160,0.22)' }} />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {results ? (
                <Text style={{ color: ink, fontFamily: font.bold, fontSize: 13, width: 38 }}>{pct}%</Text>
              ) : (
                <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: soft }} />
              )}
              <Text style={{ color: ink, fontSize: 15, flex: 1 }}>{o.text}</Text>
              {o.voted && <Check size={15} color={ink} />}
            </View>
          </Pressable>
        );
      })}
      <Text style={{ color: soft, fontSize: 12.5 }}>{poll.total_voters ? `Голосов: ${poll.total_voters}` : 'Пока никто не голосовал'}</Text>
    </View>
  );
}

/** «Печатает»: три точки нарастающей яркости. */
export function TypingDots({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }} accessibilityElementsHidden>
      {[0.45, 0.7, 1].map((o, i) => (
        <View key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color, opacity: o }} />
      ))}
    </View>
  );
}


/** Выбор коллег: поиск, отметки; уже добавленные — неактивны. */
export function PeoplePicker({ people, selected, exclude = [], meId, single, onToggle }: { people: { id: string; display_name: string; position: string | null; active: boolean }[]; selected: string[]; exclude?: string[]; meId?: string; single?: boolean; onToggle: (id: string) => void }) {
  const p = usePalette();
  const list = people.filter((u) => u.active && u.id !== meId);
  if (!list.length) return <Text tone="faint">Никого не нашлось</Text>;
  return (
    <View>
      {list.map((u, i) => {
        const off = exclude.includes(u.id);
        const on = selected.includes(u.id) || off;
        return (
          <Pressable
            key={u.id}
            disabled={off}
            accessibilityRole={single ? 'button' : 'checkbox'}
            accessibilityState={{ checked: single ? undefined : on, disabled: off }}
            accessibilityLabel={u.display_name}
            onPress={() => onToggle(u.id)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: p.line, opacity: off ? 0.5 : pressed ? 0.6 : 1 })}
          >
            <Avatar name={u.display_name} size={40} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: font.medium }}>
                {u.display_name}
              </Text>
              <Text numberOfLines={1} variant="caption" tone="faint">
                {off ? 'уже в чате' : (u.position ?? '')}
              </Text>
            </View>
            {!single && (
              <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: on ? 0 : 2, borderColor: p.line, backgroundColor: on ? p.accent : 'transparent' }}>
                {on && <Check size={14} color={p.accentInk} />}
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
