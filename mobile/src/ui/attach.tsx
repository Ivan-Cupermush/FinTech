import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { BarChart3, CalendarClock, Camera, CircleDot, FileText, Film, Images, NotebookPen, Search, SendHorizontal, UserRound, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { formatBytes, formatClock, MESSAGE_MAX, type Attachment, type Member } from '@offix/core';
import { usePeople } from '../lib/chats';
import { dropDraft, uploadPicked } from '../lib/files';
import { albumBatches, checkPicked, fromDocumentAsset, fromImageAsset, pickedKind, uploadFields, type PickedFile } from '../lib/media';
import { font } from '../lib/theme';
import { PeoplePicker, useWall } from './chats';
import { Glass } from './fx/Glass';
import { NO_WEB_OUTLINE, Text } from './primitives';

/** Шторка: на iOS — настоящее стекло, в вебе и на Android — плотная подложка, чтобы лента не просвечивала. */
export const sheetFill = (w: { ink: string }) => (Platform.OS === 'ios' ? undefined : { backgroundColor: w.ink === '#11152e' ? 'rgba(250,250,253,0.97)' : 'rgba(20,22,40,0.97)' });

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Не получилось, попробуйте ещё раз');

// ---------------------------------------------------------------- откуда взять

export async function pickGallery(): Promise<PickedFile[]> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 30, quality: 0.85, exif: false });
  return r.canceled ? [] : r.assets.map(fromImageAsset);
}

export async function pickCamera(): Promise<PickedFile[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Нет доступа к камере', 'Разрешите offix пользоваться камерой в настройках телефона.');
    return [];
  }
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.85, exif: false });
  return r.canceled ? [] : r.assets.map(fromImageAsset);
}

export async function pickDocuments(): Promise<PickedFile[]> {
  const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  return r.canceled ? [] : r.assets.map(fromDocumentAsset);
}

/** Плитка меню: круг с живым градиентом своего цвета. */
function Tile({ label, hue, icon, onPress }: { label: string; hue: number; icon: ReactNode; onPress: () => void }) {
  const w = useWall();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ width: '25%', alignItems: 'center', gap: 7, transform: [{ scale: pressed ? 0.93 : 1 }] })}>
      <View style={{ width: 58, height: 58, borderRadius: 29, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', shadowColor: `hsl(${hue}, 90%, 50%)`, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }}>
        <Svg width={58} height={58} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={`t${hue}`} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={`hsl(${hue}, 92%, 66%)`} />
              <Stop offset="1" stopColor={`hsl(${(hue + 40) % 360}, 86%, 50%)`} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#t${hue})`} />
        </Svg>
        {/* Значок — в своём View: в веб-сборке иначе ляжет под градиент. */}
        <View>{icon}</View>
      </View>
      <Text style={{ color: w.ink, fontSize: 12.5, fontFamily: font.medium }}>{label}</Text>
    </Pressable>
  );
}

/** Меню «Вложения»: галерея, камера, файл, контакт, заметка, кружочек, опрос и «позже» — стеклянная шторка снизу. */
export function AttachMenu({ onClose, onFiles, onContact, onMyNote, onVideoNote, onPoll, onSchedule }: { onClose: () => void; onFiles: (files: PickedFile[], asFile: boolean) => void; onContact: () => void; onMyNote?: () => void; onVideoNote?: () => void; onPoll?: () => void; onSchedule?: () => void }) {
  const insets = useSafeAreaInsets();
  const w = useWall();
  const run = (fn: () => Promise<PickedFile[]>, asFile: boolean) => () => {
    onClose();
    void fn()
      .then((files) => files.length && onFiles(files, asFile))
      .catch((e) => Alert.alert('Не получилось выбрать', errText(e)));
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Закрыть" onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(5,8,30,0.3)' }} />
      <View style={{ paddingHorizontal: 10, paddingBottom: Math.max(insets.bottom, 10) }}>
        <Glass tone="surface" radius={30} style={sheetFill(w)}>
          <View accessibilityRole="menu" accessibilityLabel="Вложения" style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 18, paddingVertical: 20, paddingHorizontal: 6 }}>
            <Tile label="Галерея" hue={228} icon={<Images size={24} color="#fff" />} onPress={run(pickGallery, false)} />
            {Platform.OS !== 'web' && <Tile label="Камера" hue={340} icon={<Camera size={24} color="#fff" />} onPress={run(pickCamera, false)} />}
            <Tile label="Файл" hue={28} icon={<FileText size={24} color="#fff" />} onPress={run(pickDocuments, true)} />
            <Tile
              label="Контакт"
              hue={160}
              icon={<UserRound size={24} color="#fff" />}
              onPress={() => {
                onClose();
                onContact();
              }}
            />
            {onMyNote && (
              <Tile
                label="Заметка"
                hue={96}
                icon={<NotebookPen size={24} color="#fff" />}
                onPress={() => {
                  onClose();
                  onMyNote();
                }}
              />
            )}
            {onVideoNote && (
              <Tile
                label="Кружочек"
                hue={262}
                icon={<CircleDot size={24} color="#fff" />}
                onPress={() => {
                  onClose();
                  onVideoNote();
                }}
              />
            )}
            {onPoll && (
              <Tile
                label="Опрос"
                hue={196}
                icon={<BarChart3 size={24} color="#fff" />}
                onPress={() => {
                  onClose();
                  onPoll();
                }}
              />
            )}
            {onSchedule && (
              <Tile
                label="Позже"
                hue={48}
                icon={<CalendarClock size={24} color="#fff" />}
                onPress={() => {
                  onClose();
                  onSchedule();
                }}
              />
            )}
          </View>
        </Glass>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------- отправка

interface Item {
  key: string;
  f: PickedFile;
  progress: number;
  att?: Attachment;
  error?: string;
  ctrl?: AbortController;
}

let seq = 0;
const keyOf = (f: PickedFile) => `${f.key}~${++seq}`;

/**
 * Перед отправкой: превью, подпись и «как файл». Загрузка начинается сразу,
 * по три файла параллельно; закрыли окно — черновики удаляются с сервера.
 */
export function SendSheet({ files, asFile: initialAsFile, onClose, onSend }: { files: PickedFile[]; asFile: boolean; onClose: () => void; onSend: (batches: { attachments: Attachment[]; caption: string }[]) => void }) {
  const w = useWall();
  const insets = useSafeAreaInsets();
  const [asFile, setAsFile] = useState(initialAsFile);
  const [caption, setCaption] = useState('');
  const [check] = useState(() => checkPicked(files));
  const [items, setItems] = useState<Item[]>(() => check.ok.map((f) => ({ key: keyOf(f), f, progress: 0 })));
  const started = useRef(new Set<string>());
  const sent = useRef(false);
  const mounted = useRef(false);
  const warned = useRef(false);
  const live = useRef(items);
  live.current = items;

  useEffect(() => {
    if (warned.current || !check.problems.length) return;
    warned.current = true;
    Alert.alert('Не всё получится отправить', check.problems.join('\n'));
  }, [check]);

  const patch = useCallback((key: string, fn: (it: Item) => Item) => setItems((xs) => xs.map((x) => (x.key === key ? fn(x) : x))), []);

  useEffect(() => {
    const running = items.filter((x) => started.current.has(x.key) && !x.att && !x.error).length;
    const next = items.filter((x) => !started.current.has(x.key)).slice(0, Math.max(0, 3 - running));
    for (const it of next) {
      started.current.add(it.key);
      const ctrl = new AbortController();
      patch(it.key, (x) => ({ ...x, ctrl }));
      uploadPicked(it.f, { fields: uploadFields({ asFile: asFile && pickedKind(it.f) !== 'file' }), signal: ctrl.signal, onProgress: (p) => patch(it.key, (x) => ({ ...x, progress: p })) })
        .then((att) => patch(it.key, (x) => ({ ...x, att, progress: 1 })))
        .catch((e) => (ctrl.signal.aborted ? undefined : patch(it.key, (x) => ({ ...x, error: errText(e) }))));
    }
  }, [items, asFile, patch]);

  // Закрыли без отправки — прерываем загрузки и убираем черновики.
  // Уборка — в следующем тике: строгий режим разработки «размонтирует» понарошку.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (mounted.current || sent.current) return;
        for (const it of live.current) {
          it.ctrl?.abort();
          if (it.att) void dropDraft(it.att.id);
        }
      }, 0);
    };
  }, []);

  const toggleAsFile = (v: boolean) => {
    setAsFile(v);
    // Фото и видео грузятся заново: «как файл» сервер не сжимает и не делает превью.
    setItems((xs) =>
      xs.map((x) => {
        if (pickedKind(x.f) === 'file') return x;
        x.ctrl?.abort();
        if (x.att) void dropDraft(x.att.id);
        return { key: keyOf(x.f), f: x.f, progress: 0 };
      }),
    );
  };

  const visual = items.some((x) => pickedKind(x.f) !== 'file');
  const ready = items.length > 0 && items.every((x) => x.att);
  const failed = items.filter((x) => x.error);
  const total = items.length ? items.reduce((s, x) => s + x.progress, 0) / items.length : 0;
  const media = !asFile && items.every((x) => pickedKind(x.f) !== 'file');
  const n = items.length;
  const title = media ? `${n} ${n === 1 ? 'медиафайл' : n < 5 ? 'медиафайла' : 'медиафайлов'}` : `${n} ${n === 1 ? 'файл' : n < 5 ? 'файла' : 'файлов'}`;
  const tooLong = caption.trim().length > MESSAGE_MAX;

  const send = () => {
    if (!ready || tooLong) return;
    sent.current = true;
    onSend(albumBatches(items.map((x) => x.att!), caption).map((b) => ({ attachments: b.items, caption: b.caption })));
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,8,30,0.35)' }}>
        <View style={{ paddingHorizontal: 10, paddingBottom: Math.max(insets.bottom, 10) }}>
          <Glass tone="surface" radius={30} style={sheetFill(w)}>
            <View accessibilityLabel={`Отправить ${title}`} style={{ padding: 14, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: w.ink, fontFamily: font.semibold, fontSize: 17 }}>{`Отправить ${title}`}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Отмена" onPress={onClose} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(127,127,160,0.16)' }}>
                  <X size={18} color={w.ink} />
                </Pressable>
              </View>

              <ScrollView horizontal={media} style={{ maxHeight: media ? 132 : 260 }} contentContainerStyle={media ? { gap: 8 } : { gap: 6 }} showsHorizontalScrollIndicator={false}>
                {items.map((x) => (media ? <MediaChip key={x.key} it={x} /> : <FileChip key={x.key} it={x} ink={w.ink} soft={w.inkSoft} />))}
              </ScrollView>

              {visual && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: w.ink, fontFamily: font.medium }}>Отправить как файл</Text>
                    <Text style={{ color: w.inkSoft, fontSize: 12.5 }}>Без сжатия, в исходном качестве</Text>
                  </View>
                  <Switch accessibilityLabel="Отправить как файл" value={asFile} onValueChange={toggleAsFile} trackColor={{ false: 'rgba(127,127,160,0.35)', true: '#3b5bff' }} thumbColor="#fff" {...(Platform.OS === 'web' ? { activeThumbColor: '#fff' } : {})} />
                </View>
              )}

              {failed.length > 0 && <Text style={{ color: '#e0464c', fontSize: 13 }}>{failed.map((x) => `«${x.f.name}»: ${x.error}`).join('\n')}</Text>}

              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 4, paddingLeft: 14, borderRadius: 24, backgroundColor: 'rgba(127,127,160,0.12)' }}>
                <TextInput
                  value={caption}
                  onChangeText={setCaption}
                  placeholder="Подпись"
                  placeholderTextColor={w.inkSoft}
                  multiline
                  numberOfLines={Platform.OS === 'web' ? 1 : undefined}
                  accessibilityLabel="Подпись"
                  style={[{ flex: 1, minHeight: 40, maxHeight: 120, paddingTop: 10, paddingBottom: 10, color: w.ink, fontFamily: font.regular, fontSize: 16, textAlignVertical: 'top' }, NO_WEB_OUTLINE]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Отправить"
                  accessibilityState={{ disabled: !ready || tooLong, busy: !ready }}
                  disabled={!ready || tooLong || failed.length === items.length}
                  onPress={send}
                  style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: ready && !tooLong ? '#3b5bff' : 'rgba(127,127,160,0.35)', transform: [{ scale: pressed ? 0.92 : 1 }] })}
                >
                  {ready ? <SendHorizontal size={19} color="#fff" /> : <ProgressDot p={total} />}
                </Pressable>
              </View>
              {failed.length > 0 && (
                <Pressable accessibilityRole="button" onPress={() => setItems((xs) => xs.filter((x) => !x.error))}>
                  <Text style={{ color: '#3b5bff', fontFamily: font.semibold, fontSize: 13.5 }}>Отправить без них</Text>
                </Pressable>
              )}
            </View>
          </Glass>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ProgressDot({ p }: { p: number }) {
  return (
    <View accessibilityLabel={`Загружено ${Math.round(p * 100)}%`} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#fff" size="small" />
      <Text style={{ position: 'absolute', color: '#fff', fontSize: 8, fontFamily: font.bold }}>{Math.round(p * 100)}</Text>
    </View>
  );
}

/** Превью фото и видео: локальный снимок, полоса загрузки поверх. */
function MediaChip({ it }: { it: Item }) {
  const video = pickedKind(it.f) === 'video';
  return (
    <View style={{ width: 112, height: 132, borderRadius: 18, overflow: 'hidden', backgroundColor: '#14183c' }}>
      {!video || Platform.OS === 'ios' ? <Image source={{ uri: it.f.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}><Film size={28} color="rgba(255,255,255,0.8)" /></View>}
      {video && (
        <View style={{ position: 'absolute', left: 6, top: 6, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, backgroundColor: 'rgba(8,10,30,0.55)' }}>
          <Text style={{ color: '#fff', fontSize: 11, fontFamily: font.semibold }}>{formatClock(it.f.duration)}</Text>
        </View>
      )}
      <ChipProgress it={it} />
    </View>
  );
}

function FileChip({ it, ink, soft }: { it: Item; ink: string; soft: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 16, backgroundColor: 'rgba(127,127,160,0.1)', overflow: 'hidden' }}>
      <FileText size={22} color="#3b5bff" />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: ink, fontFamily: font.medium }}>
          {it.f.name}
        </Text>
        <Text style={{ color: it.error ? '#e0464c' : soft, fontSize: 12.5 }}>{it.error ?? (it.att ? formatBytes(it.att.size) : `${formatBytes(it.f.size)} · ${Math.round(it.progress * 100)}%`)}</Text>
      </View>
      <ChipProgress it={it} />
    </View>
  );
}

function ChipProgress({ it }: { it: Item }) {
  if (it.att || it.error) return null;
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.25)' }}>
      <View style={{ width: `${Math.round(it.progress * 100)}%`, height: 3, backgroundColor: '#3b5bff' }} />
    </View>
  );
}

// ---------------------------------------------------------------- контакт

/** Отправить контакт: поиск коллеги, одно касание — карточка уходит в чат. */
export function ContactSheet({ meId, onClose, onPick }: { meId: string; onClose: () => void; onPick: (u: Member) => void }) {
  const w = useWall();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const people = usePeople(q.trim());
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,8,30,0.35)' }}>
        <View style={{ paddingHorizontal: 10, paddingBottom: Math.max(insets.bottom, 10), maxHeight: '82%' }}>
          <Glass tone="surface" radius={30} style={sheetFill(w)}>
            <View accessibilityLabel="Отправить контакт" style={{ padding: 14, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: w.ink, fontFamily: font.semibold, fontSize: 17 }}>Отправить контакт</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Отмена" onPress={onClose} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(127,127,160,0.16)' }}>
                  <X size={18} color={w.ink} />
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 16, backgroundColor: 'rgba(127,127,160,0.12)' }}>
                <Search size={16} color={w.inkSoft} />
                <TextInput value={q} onChangeText={setQ} placeholder="Найти коллегу" placeholderTextColor={w.inkSoft} accessibilityLabel="Найти коллегу" style={[{ flex: 1, height: 42, color: w.ink, fontFamily: font.regular, fontSize: 16 }, NO_WEB_OUTLINE]} />
              </View>
              <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
                {people.isLoading ? <ActivityIndicator color={w.ink} /> : <PeoplePicker people={people.data ?? []} selected={[]} meId={meId} single onToggle={(id) => { const u = people.data?.find((x) => x.id === id); if (u) onPick(u); }} />}
              </ScrollView>
            </View>
          </Glass>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
