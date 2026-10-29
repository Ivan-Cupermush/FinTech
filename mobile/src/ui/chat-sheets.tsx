import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, Plus, Search, Send, Trash2, X } from 'lucide-react-native';
import { useId, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { mergeMessages, MESSAGE_MAX, POLL_OPTIONS_MAX, type ChatHistory, type ChatMessage, type ChatSummary, type ScheduledMessage } from '@offix/core';
import { chatApi, ck, useChats, useScheduled, useVoters } from '../lib/chats';
import { emptyPoll, forwardTargets, nextSlot, pollRequest, removePollOption, scheduleAt, scheduleDays, scheduleLabel, schedulePresets, scheduleTimes, type PollForm } from '../lib/compose';
import { font } from '../lib/theme';
import { sheetFill } from './attach';
import { ChatAvatar, useWall } from './chats';
import { Glass } from './fx/Glass';
import { Avatar, NO_WEB_OUTLINE, Text } from './primitives';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Не получилось, попробуйте ещё раз');
const BLUE = '#3b5bff';

// ---------------------------------------------------------------- основа шторки

/** Стеклянная шторка снизу: заголовок, крестик, прокручиваемое тело и кнопка действия. */
function Sheet({ title, sub, onClose, children, footer, tall }: { title: string; sub?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; tall?: boolean }) {
  const w = useWall();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,8,30,0.38)' }}>
        <Pressable accessibilityLabel="Закрыть" onPress={onClose} style={{ flex: 1 }} />
        <View style={{ paddingHorizontal: 10, paddingBottom: Math.max(insets.bottom, 10), maxHeight: tall ? '92%' : '86%' }}>
          <Glass tone="surface" radius={30} style={sheetFill(w)}>
            <View accessibilityLabel={title} style={{ paddingTop: 10, paddingHorizontal: 14, paddingBottom: 14, gap: 12 }}>
              <View style={{ alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(127,127,160,0.35)' }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text accessibilityRole="header" style={{ color: w.ink, fontFamily: font.semibold, fontSize: 18 }}>
                    {title}
                  </Text>
                  {sub ? <Text style={{ color: w.inkSoft, fontSize: 13 }}>{sub}</Text> : null}
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(127,127,160,0.16)' }}>
                  <X size={18} color={w.ink} />
                </Pressable>
              </View>
              <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {children}
              </ScrollView>
              {footer}
            </View>
          </Glass>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Главная кнопка шторки — живой градиент offix. */
function SheetButton({ title, icon, onPress, busy, disabled }: { title: string; icon?: ReactNode; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  const off = disabled || busy;
  const gid = `sb${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({ height: 50, borderRadius: 25, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.98 : 1 }], shadowColor: BLUE, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } })}
    >
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#5b7bff" />
            <Stop offset="0.55" stopColor="#3b5bff" />
            <Stop offset="1" stopColor="#7a4dff" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${gid})`} />
      </Svg>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {busy ? <ActivityIndicator color="#fff" /> : icon}
        <Text style={{ color: '#fff', fontFamily: font.semibold, fontSize: 16 }}>{title}</Text>
      </View>
    </Pressable>
  );
}

function Field({ value, onChange, placeholder, label, multiline, error, autoFocus, left }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string; multiline?: boolean; error?: string | null; autoFocus?: boolean; left?: ReactNode }) {
  const w = useWall();
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', gap: 8, paddingHorizontal: 12, borderRadius: 16, backgroundColor: 'rgba(127,127,160,0.12)', borderWidth: StyleSheet.hairlineWidth, borderColor: error ? '#e0464c' : 'transparent' }}>
        {left}
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={w.inkSoft}
          accessibilityLabel={label}
          multiline={multiline}
          autoFocus={autoFocus}
          numberOfLines={multiline && Platform.OS === 'web' ? 3 : undefined}
          style={[{ flex: 1, minHeight: multiline ? 76 : 44, maxHeight: 160, paddingVertical: multiline ? 12 : 0, color: w.ink, fontFamily: font.regular, fontSize: 16, textAlignVertical: multiline ? 'top' : 'center' }, NO_WEB_OUTLINE]}
        />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: '#e0464c', fontSize: 12.5, paddingHorizontal: 4 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function SwitchRow({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const w = useWall();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: disabled ? 0.45 : 1 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: w.ink, fontFamily: font.medium, fontSize: 15 }}>{label}</Text>
        {hint ? <Text style={{ color: w.inkSoft, fontSize: 12.5 }}>{hint}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ false: 'rgba(127,127,160,0.35)', true: BLUE }} thumbColor="#fff" {...(Platform.OS === 'web' ? { activeThumbColor: '#fff' } : {})} />
    </View>
  );
}

function Chip({ label, sub, on, disabled, onPress, width }: { label: string; sub?: string; on: boolean; disabled?: boolean; onPress: () => void; width?: number }) {
  const w = useWall();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled: !!disabled }}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ width, minWidth: 54, paddingHorizontal: 12, paddingVertical: sub ? 7 : 9, borderRadius: 16, alignItems: 'center', backgroundColor: on ? BLUE : 'rgba(127,127,160,0.12)', opacity: disabled ? 0.35 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] })}
    >
      <Text style={{ color: on ? '#fff' : w.ink, fontFamily: font.semibold, fontSize: 14, fontVariant: ['tabular-nums'] }}>{label}</Text>
      {sub ? <Text style={{ color: on ? 'rgba(255,255,255,0.8)' : w.inkSoft, fontSize: 11.5 }}>{sub}</Text> : null}
    </Pressable>
  );
}

const putMessage = (qc: ReturnType<typeof useQueryClient>, chatId: string, topicId: string | null, m: ChatMessage) =>
  qc.setQueryData<ChatHistory>(ck.history(chatId, topicId), (h) => (h ? { ...h, messages: mergeMessages(h.messages, [m]) } : h));

// ---------------------------------------------------------------- опрос

/** Новый опрос: вопрос, до десяти вариантов, анонимный, несколько ответов или викторина. */
export function PollSheet({ chatId, topicId, onClose, onCreated }: { chatId: string; topicId: string | null; onClose: () => void; onCreated: () => void }) {
  const w = useWall();
  const qc = useQueryClient();
  const [f, setF] = useState<PollForm>(emptyPoll);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const { errors, body } = pollRequest(f, topicId);
  const show = (k: string) => (touched ? (errors[k] ?? null) : null);
  const set = (patch: Partial<PollForm>) => setF((x) => ({ ...x, ...patch }));

  const submit = async () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const m = await chatApi.createPoll(chatId, body);
      putMessage(qc, chatId, topicId, m);
      void qc.invalidateQueries({ queryKey: ck.list });
      onCreated();
      onClose();
    } catch (e) {
      Alert.alert('Опрос не отправился', errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={f.quiz ? 'Викторина' : 'Опрос'} sub={f.quiz ? 'Один правильный ответ — все увидят его после голоса' : 'Коллеги ответят одним касанием'} onClose={onClose} tall footer={<SheetButton title={f.quiz ? 'Отправить викторину' : 'Отправить опрос'} onPress={submit} busy={busy} />}>
      <Field label="Вопрос" value={f.question} onChange={(question) => set({ question })} placeholder="Когда удобнее созвониться?" error={show('question')} autoFocus />
      <View style={{ gap: 6 }}>
        <Text style={{ color: w.inkSoft, fontFamily: font.semibold, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 4 }}>{f.quiz ? 'Варианты — отметьте правильный' : 'Варианты ответа'}</Text>
        {f.options.map((o, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {f.quiz && (
              <Pressable accessibilityRole="radio" accessibilityState={{ checked: f.correct === i }} accessibilityLabel={`Правильный ответ — вариант ${i + 1}`} onPress={() => set({ correct: i })} hitSlop={6} style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: f.correct === i ? '#1fae6b' : w.inkSoft, backgroundColor: f.correct === i ? '#1fae6b' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {f.correct === i && <Check size={15} color="#fff" strokeWidth={3} />}
              </Pressable>
            )}
            <View style={{ flex: 1 }}>
              <Field label={`Вариант ${i + 1}`} value={o} placeholder={`Вариант ${i + 1}`} onChange={(v) => set({ options: f.options.map((y, j) => (j === i ? v : y)) })} />
            </View>
            {f.options.length > 2 && (
              <Pressable accessibilityRole="button" accessibilityLabel={`Убрать вариант ${i + 1}`} onPress={() => setF((x) => removePollOption(x, i))} hitSlop={6} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
                <X size={17} color={w.inkSoft} />
              </Pressable>
            )}
          </View>
        ))}
        {f.options.length < POLL_OPTIONS_MAX && (
          <Pressable accessibilityRole="button" onPress={() => set({ options: [...f.options, ''] })} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 6, opacity: pressed ? 0.6 : 1 })}>
            <Plus size={17} color={BLUE} />
            <Text style={{ color: BLUE, fontFamily: font.semibold, fontSize: 15 }}>Добавить вариант</Text>
          </Pressable>
        )}
        {show('options') || show('correct_option') ? (
          <Text accessibilityRole="alert" style={{ color: '#e0464c', fontSize: 12.5, paddingHorizontal: 4 }}>
            {show('options') ?? show('correct_option')}
          </Text>
        ) : null}
      </View>
      <View style={{ gap: 12, padding: 12, borderRadius: 18, backgroundColor: 'rgba(127,127,160,0.08)' }}>
        <SwitchRow label="Анонимный" hint="Не видно, кто как ответил" value={f.anonymous} onChange={(anonymous) => set({ anonymous })} />
        <SwitchRow label="Несколько ответов" value={f.multiple && !f.quiz} disabled={f.quiz} onChange={(multiple) => set({ multiple })} />
        <SwitchRow label="Викторина" hint="С правильным ответом" value={f.quiz} onChange={(quiz) => set({ quiz })} />
      </View>
      {f.quiz && <Field label="Пояснение после ответа" value={f.explanation} onChange={(explanation) => set({ explanation })} placeholder="Пояснение после ответа — необязательно" error={show('explanation')} />}
    </Sheet>
  );
}

/** Кто как проголосовал — только в открытом опросе. */
export function VotersSheet({ message, onClose }: { message: ChatMessage; onClose: () => void }) {
  const w = useWall();
  const voters = useVoters(message.id);
  const options = message.poll?.options ?? [];
  return (
    <Sheet title="Кто как проголосовал" sub={message.poll?.question} onClose={onClose}>
      {voters.isLoading && <ActivityIndicator color={w.ink} />}
      {voters.data?.map((v) => {
        const opt = options.find((o) => o.id === v.option_id);
        return (
          <View key={v.option_id} style={{ gap: 8 }}>
            <Text style={{ color: w.ink, fontFamily: font.semibold, fontSize: 15 }}>
              {opt?.text} <Text style={{ color: w.inkSoft, fontSize: 13 }}>· {v.people.length}</Text>
            </Text>
            {v.people.map((p) => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar name={p.display_name} id={p.id} size={30} />
                <Text style={{ color: w.ink, fontSize: 15 }}>{p.display_name}</Text>
              </View>
            ))}
            {!v.people.length && <Text style={{ color: w.inkSoft, fontSize: 13.5 }}>Никто</Text>}
          </View>
        );
      })}
    </Sheet>
  );
}

// ---------------------------------------------------------------- переслать и ответить в другом чате

/** Выбор чата: поиск, закреплённые сверху, касание — сразу действие. */
export function ChatPickSheet({ title, sub, exclude, onPick, onClose }: { title: string; sub?: string; exclude?: string; onPick: (c: ChatSummary) => Promise<void> | void; onClose: () => void }) {
  const w = useWall();
  const chats = useChats();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const list = forwardTargets((chats.data ?? []).filter((c) => c.id !== exclude), q);
  return (
    <Sheet title={title} sub={sub} onClose={onClose} tall>
      <Field label="Найти чат" value={q} onChange={setQ} placeholder="Найти чат" left={<Search size={16} color={w.inkSoft} />} />
      {chats.isLoading && <ActivityIndicator color={w.ink} />}
      <View accessibilityRole="list" style={{ gap: 2 }}>
        {list.map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            accessibilityLabel={c.title}
            disabled={!!busy}
            onPress={async () => {
              setBusy(c.id);
              try {
                await onPick(c);
              } finally {
                setBusy(null);
              }
            }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 16, backgroundColor: pressed ? 'rgba(127,127,160,0.14)' : 'transparent' })}
          >
            <ChatAvatar title={c.title} group={c.type === 'group'} size={42} userId={c.peer?.id} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: w.ink, fontFamily: font.semibold, fontSize: 15.5 }}>
                {c.title}
              </Text>
              <Text numberOfLines={1} style={{ color: w.inkSoft, fontSize: 13 }}>
                {c.type === 'group' ? `${c.members_count} участников` : (c.peer?.position ?? 'Личный чат')}
              </Text>
            </View>
            {busy === c.id && <ActivityIndicator color={BLUE} />}
          </Pressable>
        ))}
        {chats.data && !list.length && <Text style={{ color: w.inkSoft, textAlign: 'center', paddingVertical: 12 }}>Чатов не нашлось</Text>}
      </View>
    </Sheet>
  );
}


// ---------------------------------------------------------------- отправить позже

/**
 * Отложенное сообщение: текст, быстрые варианты и свой день со временем.
 * Время — по часам телефона; сервер отправит, даже если приложение закрыто.
 */
export function ScheduleSheet({ chatId, topicId, replyTo, initialText, onClose, onDone }: { chatId: string; topicId: string | null; replyTo?: ChatMessage | null; initialText: string; onClose: () => void; onDone: (at: Date) => void }) {
  const w = useWall();
  const qc = useQueryClient();
  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => scheduleDays(now), [now]);
  const presets = useMemo(() => schedulePresets(now), [now]);
  const start = useMemo(() => nextSlot(now), [now]);
  const [text, setText] = useState(initialText);
  const [day, setDay] = useState(Math.min(start.day, days.length - 1));
  const [hm, setHm] = useState({ h: start.h, m: start.m });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const timesRef = useRef<ComponentRef<typeof ScrollView>>(null);

  const slot = scheduleAt(days[day]!.date, hm.h, hm.m, new Date());
  const textErr = !text.trim() ? 'Напишите сообщение' : text.trim().length > MESSAGE_MAX ? `Не длиннее ${MESSAGE_MAX} символов` : null;
  // Сетка по четверть часа; время из «через час» вставляем на своё место.
  const times = useMemo(() => {
    const t = scheduleTimes();
    if (!t.some((x) => x.h === hm.h && x.m === hm.m)) t.push({ h: hm.h, m: hm.m, label: `${String(hm.h).padStart(2, '0')}:${String(hm.m).padStart(2, '0')}` });
    return t.sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
  }, [hm]);
  const past = (h: number, m: number) => day === 0 && h * 60 + m <= now.getHours() * 60 + now.getMinutes();
  const selectedIndex = times.findIndex((x) => x.h === hm.h && x.m === hm.m);

  const pick = (at: Date) => {
    const i = days.findIndex((d) => d.date.toDateString() === at.toDateString());
    if (i >= 0) setDay(i);
    setHm({ h: at.getHours(), m: at.getMinutes() });
  };

  const submit = async () => {
    setTouched(true);
    if (textErr || slot.error) return;
    setBusy(true);
    try {
      await chatApi.schedule(chatId, { text: text.trim(), send_at: slot.at.toISOString(), topic_id: topicId, reply_to_id: replyTo?.id ?? null });
      void qc.invalidateQueries({ queryKey: ck.scheduled(chatId) });
      onDone(slot.at);
      onClose();
    } catch (e) {
      Alert.alert('Не получилось запланировать', errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Отправить позже"
      sub={slot.error ? undefined : `Отправим ${scheduleLabel(slot.at, now)}`}
      onClose={onClose}
      tall
      footer={<SheetButton title="Запланировать" icon={<CalendarClock size={18} color="#fff" />} onPress={submit} busy={busy} />}
    >
      <Field label="Сообщение" value={text} onChange={setText} multiline placeholder="Что отправить" error={touched ? textErr : null} autoFocus={!initialText} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {presets.map((p) => (
          <Chip key={p.label} label={p.label} on={p.at.getTime() === slot.at.getTime()} onPress={() => pick(p.at)} />
        ))}
      </ScrollView>
      <View style={{ gap: 6 }}>
        <Text style={{ color: w.inkSoft, fontFamily: font.semibold, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 4 }}>День</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityRole="radiogroup">
          {days.map((d, i) => (
            <Chip key={d.key} label={d.label} sub={d.sub} on={i === day} onPress={() => setDay(i)} />
          ))}
        </ScrollView>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={{ color: w.inkSoft, fontFamily: font.semibold, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 4 }}>Время</Text>
        <ScrollView
          ref={timesRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
          accessibilityRole="radiogroup"
          // Выбранное время — сразу на виду, а не где-то в начале дня.
          onLayout={() => timesRef.current?.scrollTo({ x: Math.max(0, selectedIndex * 70 - 110), animated: false })}
        >
          {times.map((t) => (
            <Chip key={t.label} label={t.label} width={64} on={t.h === hm.h && t.m === hm.m} disabled={past(t.h, t.m)} onPress={() => setHm({ h: t.h, m: t.m })} />
          ))}
        </ScrollView>
      </View>
      {slot.error && (touched || day === 0) ? (
        <Text accessibilityRole="alert" style={{ color: '#e0464c', fontSize: 13, paddingHorizontal: 4 }}>
          {slot.error}
        </Text>
      ) : null}
    </Sheet>
  );
}

/** Запланированные в этом чате: отправить сейчас или удалить. */
export function ScheduledSheet({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const w = useWall();
  const qc = useQueryClient();
  const list = useScheduled(chatId);
  const now = new Date();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (s: ScheduledMessage, fn: () => Promise<unknown>) => {
    setBusy(s.id);
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: ck.scheduled(chatId) });
    } catch (e) {
      Alert.alert('Не получилось', errText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet title="Отложенные" sub="Уйдут сами в назначенное время" onClose={onClose}>
      {list.isLoading && <ActivityIndicator color={w.ink} />}
      {list.data && !list.data.length && <Text style={{ color: w.inkSoft, textAlign: 'center', paddingVertical: 16 }}>Запланированных сообщений нет</Text>}
      {list.data?.map((s) => (
        <View key={s.id} style={{ gap: 8, padding: 12, borderRadius: 18, backgroundColor: 'rgba(127,127,160,0.1)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <CalendarClock size={14} color={BLUE} />
            <Text style={{ color: BLUE, fontFamily: font.semibold, fontSize: 13 }}>{scheduleLabel(s.send_at, now)}</Text>
          </View>
          <Text style={{ color: w.ink, fontSize: 15, lineHeight: 21 }} numberOfLines={4}>
            {s.text}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable accessibilityRole="button" disabled={busy === s.id} onPress={() => void act(s, () => chatApi.sendScheduled(chatId, s.id))} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: 'rgba(59,91,255,0.14)', opacity: pressed ? 0.7 : 1 })}>
              {busy === s.id ? <ActivityIndicator size="small" color={BLUE} /> : <Send size={14} color={BLUE} />}
              <Text style={{ color: BLUE, fontFamily: font.semibold, fontSize: 13.5 }}>Отправить сейчас</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy === s.id} onPress={() => void act(s, () => chatApi.dropScheduled(chatId, s.id))} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, opacity: pressed ? 0.7 : 1 })}>
              <Trash2 size={14} color="#e0464c" />
              <Text style={{ color: '#e0464c', fontFamily: font.semibold, fontSize: 13.5 }}>Удалить</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </Sheet>
  );
}
