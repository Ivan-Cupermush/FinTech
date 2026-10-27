import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Download, Film, MessageCircle, Pause, Play } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, useColorScheme, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { albumLayout, decodeWaveform, fileExtension, formatBytes, formatClock, resample, waveBars, type Attachment, type ContactCard } from '@offix/core';
import { absUri, freshUrl, openAttachment, useFileUri } from '../lib/files';
import { nextRate, progressOf, rateLabel } from '../lib/media';
import { font } from '../lib/theme';
import { Avatar, Text } from './primitives';

const HUES = [228, 262, 160, 28, 340, 196, 48, 290];
const hueOf = (s: string) => HUES[[...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0) % HUES.length]!;
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Не получилось, попробуйте ещё раз');

// ---------------------------------------------------------------- альбом

/** Превью ячейки: публичная миниатюра; у GIF и снимков без миниатюры — сам файл. */
function useCellUri(a: Attachment) {
  const full = a.kind === 'photo' && (!a.thumb_url || a.mime === 'image/gif');
  const uri = useFileUri(a, full);
  return full ? uri : absUri(a.thumb_url);
}

function AlbumCell({ a, style, label, radius, onOpen }: { a: Attachment; style: object; label: string; radius: object; onOpen: () => void }) {
  const uri = useCellUri(a);
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={label} onPress={onOpen} style={({ pressed }) => [{ position: 'absolute', overflow: 'hidden', backgroundColor: 'rgba(20,24,60,0.35)', opacity: pressed ? 0.85 : 1 }, style, radius]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>{a.kind === 'video' && <Film size={26} color="rgba(255,255,255,0.8)" />}</View>}
      {a.kind === 'video' && (
        <>
          <View style={{ position: 'absolute', left: '50%', top: '50%', width: 46, height: 46, marginLeft: -23, marginTop: -23, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(8,10,30,0.45)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.45)' }}>
            <Play size={20} color="#fff" fill="#fff" style={{ marginLeft: 3 }} />
          </View>
          <View style={{ position: 'absolute', left: 6, top: 6, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: 'rgba(8,10,30,0.55)' }}>
            <Text style={{ color: '#fff', fontSize: 11.5, fontFamily: font.semibold, fontVariant: ['tabular-nums'] }}>{formatClock(a.duration)}</Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

/**
 * Альбом в пузыре: та же мозаика, что на сайте (раскладку считает core),
 * углы ячеек повторяют скругление пузыря.
 */
export function Album({ items, maxWidth, maxHeight = 380, radius = 16, flatTop, flatBottom, onOpen }: { items: Attachment[]; maxWidth: number; maxHeight?: number; radius?: number; flatTop?: boolean; flatBottom?: boolean; onOpen: (index: number) => void }) {
  const layout = useMemo(() => albumLayout(items.map((a) => (a.width && a.height ? a.width / a.height : 1)), maxWidth, maxHeight, 2), [items, maxWidth, maxHeight]);
  const W = layout.width;
  const H = layout.height;
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  return (
    <View style={{ width: W, height: H }}>
      {items.map((a, i) => {
        const c = layout.cells[i]!;
        const left = near(c.x, 0);
        const top = near(c.y, 0) && !flatTop;
        const right = near(c.x + c.w, W);
        const bottom = near(c.y + c.h, H) && !flatBottom;
        const corners = { borderTopLeftRadius: left && top ? radius : 3, borderTopRightRadius: right && top ? radius : 3, borderBottomLeftRadius: left && bottom ? radius : 3, borderBottomRightRadius: right && bottom ? radius : 3 };
        const label = `${a.kind === 'video' ? 'Видео' : 'Фото'}${items.length > 1 ? ` ${i + 1} из ${items.length}` : ''} — открыть`;
        return <AlbumCell key={a.id} a={a} style={{ left: c.x, top: c.y, width: c.w, height: c.h }} radius={corners} label={label} onOpen={() => onOpen(i)} />;
      })}
    </View>
  );
}

// ---------------------------------------------------------------- файл

/** Файл строкой: плитка с расширением своего цвета, имя и размер; касание — открыть или сохранить. */
export function FileRow({ a, ink, soft, onTile }: { a: Attachment; ink: string; soft: string; onTile?: boolean }) {
  const [busy, setBusy] = useState(false);
  const ext = fileExtension(a.name).slice(0, 4).toUpperCase() || 'FILE';
  const h = hueOf(ext);
  const open = () => {
    setBusy(true);
    openAttachment(a)
      .catch((e) => Alert.alert('Файл не открылся', errText(e)))
      .finally(() => setBusy(false));
  };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Открыть ${a.name}, ${formatBytes(a.size)}`} onPress={open} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, opacity: pressed ? 0.7 : 1, minWidth: onTile ? undefined : 210, maxWidth: '100%' })}>
      <View style={{ width: 46, height: 46, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={46} height={46} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={`f${h}`} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={`hsl(${h}, 88%, 64%)`} />
              <Stop offset="1" stopColor={`hsl(${(h + 36) % 360}, 82%, 48%)`} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#f${h})`} />
        </Svg>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: ext.length > 3 ? 11 : 12.5, letterSpacing: 0.3 }}>{ext}</Text>}
      </View>
      <View style={{ flexShrink: 1, minWidth: 0, gap: 1 }}>
        <Text numberOfLines={1} style={{ color: ink, fontFamily: font.semibold, fontSize: 15 }}>
          {a.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Download size={12} color={soft} />
          <Text style={{ color: soft, fontSize: 12.5 }}>{`${formatBytes(a.size)} · ${ext}`}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------- голосовое

/** Одновременно играет одно: новое голосовое ставит на паузу прежнее. */
let playing: AudioPlayer | null = null;
let savedRate = 1;

function claim(p: AudioPlayer) {
  if (playing && playing !== p) {
    try {
      playing.pause();
    } catch {
      // Плеер уже освобождён — ничего.
    }
  }
  playing = p;
}

/** Волна: прослушанная часть — насыщенная, остальная — прозрачная; касание по волне — перемотка. */
export function Waveform({ levels, progress, color, rest, onSeek }: { levels: number[]; progress: number; color: string; rest: string; onSeek?: (f: number) => void }) {
  const [w, setW] = useState(150);
  const bars = useMemo(() => resample(levels, waveBars(w)), [levels, w]);
  return (
    <Pressable
      accessibilityRole="adjustable"
      accessibilityLabel="Перемотка голосового"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      onPress={(e) => onSeek?.(Math.max(0, Math.min(1, e.nativeEvent.locationX / Math.max(1, w))))}
      style={{ flex: 1, height: 28, flexDirection: 'row', alignItems: 'center', gap: 2 }}
    >
      {bars.map((v, i) => (
        <View key={i} style={{ width: 3, height: Math.max(3, Math.round(v * 26)), borderRadius: 2, backgroundColor: (i + 0.5) / bars.length <= progress ? color : rest }} />
      ))}
    </Pressable>
  );
}

/** Голосовое: волна, длительность, скорость 1× / 1,5× / 2× и точка «не прослушано». */
export function VoiceBubble({ a, mine, listened, ink, soft, onListen }: { a: Attachment; mine: boolean; listened: boolean; ink: string; soft: string; onListen?: () => void }) {
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const loaded = useRef<string | null>(null);
  const [rate, setRate] = useState(savedRate);
  const [busy, setBusy] = useState(false);
  const total = status.duration > 0 ? status.duration : (a.duration ?? 0);
  const levels = useMemo(() => decodeWaveform(a.waveform, a.id), [a.waveform, a.id]);
  const progress = progressOf(status.currentTime, total);
  const on = status.playing;

  useEffect(() => {
    if (!status.didJustFinish) return;
    player.pause();
    void player.seekTo(0);
  }, [status.didJustFinish, player]);

  const play = async (from?: number) => {
    setBusy(!loaded.current);
    try {
      if (!loaded.current) {
        const uri = absUri(await freshUrl(a))!;
        await setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
        player.replace({ uri });
        loaded.current = uri;
      }
      if (from !== undefined && total) await player.seekTo(from * total);
      player.setPlaybackRate(rate);
      claim(player);
      player.play();
      if (!mine && !listened) onListen?.();
    } catch (e) {
      Alert.alert('Не получилось включить', errText(e));
    } finally {
      setBusy(false);
    }
  };

  const dark = useColorScheme() === 'dark';
  const accent = mine ? '#fff' : dark ? '#8fa2ff' : '#3b5bff';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 220, paddingVertical: 2 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={on ? 'Пауза' : 'Слушать голосовое'}
        onPress={() => (on ? player.pause() : void play())}
        style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: mine ? 'rgba(255,255,255,0.95)' : '#3b5bff', transform: [{ scale: pressed ? 0.92 : 1 }], shadowColor: '#2f4bff', shadowOpacity: mine ? 0 : 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } })}
      >
        {busy ? <ActivityIndicator color={mine ? '#3b5bff' : '#fff'} /> : on ? <Pause size={19} color={mine ? '#3b5bff' : '#fff'} fill={mine ? '#3b5bff' : '#fff'} /> : <Play size={19} color={mine ? '#3b5bff' : '#fff'} fill={mine ? '#3b5bff' : '#fff'} style={{ marginLeft: 2 }} />}
      </Pressable>
      <View style={{ flex: 1, gap: 3 }}>
        <Waveform levels={levels} progress={progress} color={accent} rest={mine ? 'rgba(255,255,255,0.42)' : dark ? 'rgba(143,162,255,0.32)' : 'rgba(59,91,255,0.3)'} onSeek={(f) => (loaded.current && total ? void player.seekTo(f * total) : void play(f))} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: soft, fontSize: 12, fontVariant: ['tabular-nums'] }}>{formatClock(on || status.currentTime > 0 ? status.currentTime : total)}</Text>
          {!listened && !mine && <View accessibilityLabel="Не прослушано" style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: accent }} />}
          {on && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Скорость ${rateLabel(rate)}`}
              hitSlop={8}
              onPress={() => {
                const r = nextRate(rate);
                savedRate = r;
                setRate(r);
                player.setPlaybackRate(r);
              }}
              style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 9, backgroundColor: mine ? 'rgba(255,255,255,0.22)' : 'rgba(59,91,255,0.14)' }}
            >
              <Text style={{ color: ink, fontSize: 11.5, fontFamily: font.bold }}>{rateLabel(rate)}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- кружочек

const NOTE = 208;

/**
 * Видеосообщение: без звука крутится по кругу, касание — сначала и со звуком,
 * вокруг бежит кольцо прогресса. Повторное касание — снова без звука.
 */
export function VideoNoteBubble({ a, mine, listened, onListen, onLongPress }: { a: Attachment; mine: boolean; listened: boolean; onListen?: () => void; onLongPress?: () => void }) {
  const uri = useFileUri(a);
  const player = useVideoPlayer(uri ? { uri } : null, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 0.2;
    p.play();
  });
  const [active, setActive] = useState(false);
  const [time, setTime] = useState(0);
  const total = a.duration ?? 0;
  useEventListener(player, 'timeUpdate', (e) => setTime(e.currentTime));
  useEventListener(player, 'playToEnd', () => {
    if (!active) return;
    setActive(false);
    player.muted = true;
  });

  const toggle = () => {
    if (active) {
      setActive(false);
      player.muted = true;
      return;
    }
    setActive(true);
    player.currentTime = 0;
    player.muted = false;
    player.play();
    if (!mine && !listened) onListen?.();
  };

  const r = NOTE / 2 - 3;
  const len = 2 * Math.PI * r;
  const p = active ? progressOf(time, total) : 0;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={active ? 'Выключить звук видеосообщения' : 'Смотреть видеосообщение'} onPress={toggle} onLongPress={onLongPress} delayLongPress={320} style={{ width: NOTE, height: NOTE }}>
      <View style={{ width: NOTE, height: NOTE, borderRadius: NOTE / 2, overflow: 'hidden', backgroundColor: '#0d1030' }}>
        {uri ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} /> : a.thumb_url ? <Image source={{ uri: absUri(a.thumb_url) }} style={StyleSheet.absoluteFill} /> : null}
      </View>
      <Svg width={NOTE} height={NOTE} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Circle cx={NOTE / 2} cy={NOTE / 2} r={r} stroke="rgba(255,255,255,0.35)" strokeWidth={active ? 3 : 1.5} fill="none" />
        {active && <Circle cx={NOTE / 2} cy={NOTE / 2} r={r} stroke="#fff" strokeWidth={3.5} fill="none" strokeLinecap="round" strokeDasharray={`${len} ${len}`} strokeDashoffset={len * (1 - p)} transform={`rotate(-90 ${NOTE / 2} ${NOTE / 2})`} />}
      </Svg>
      <View style={{ position: 'absolute', left: 14, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(8,10,30,0.55)' }}>
        <Text style={{ color: '#fff', fontSize: 11.5, fontFamily: font.semibold, fontVariant: ['tabular-nums'] }}>{formatClock(active ? time : total)}</Text>
        {!listened && !mine && <View accessibilityLabel="Не просмотрено" style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#9ef0ff' }} />}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------- контакт

/** Карточка контакта: фото, должность и «Написать» — сразу в личный чат. */
export function ContactBubble({ c, mine, ink, soft, onWrite }: { c: ContactCard; mine: boolean; ink: string; soft: string; onWrite: (c: ContactCard) => void }) {
  return (
    <View style={{ gap: 8, minWidth: 220 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar name={c.display_name} id={c.id} uri={absUri(c.avatar_url)} size={44} />
        <View style={{ flexShrink: 1 }}>
          <Text numberOfLines={1} style={{ color: ink, fontFamily: font.semibold, fontSize: 15.5 }}>
            {c.display_name}
          </Text>
          {c.position && (
            <Text numberOfLines={1} style={{ color: soft, fontSize: 13 }}>
              {c.position}
            </Text>
          )}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Написать: ${c.display_name}`}
        onPress={() => onWrite(c)}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 34, borderRadius: 12, backgroundColor: mine ? 'rgba(255,255,255,0.2)' : 'rgba(59,91,255,0.12)', opacity: pressed ? 0.7 : 1 })}
      >
        <MessageCircle size={15} color={mine ? '#fff' : '#3b5bff'} />
        <Text style={{ color: mine ? '#fff' : '#3b5bff', fontFamily: font.semibold, fontSize: 14 }}>Написать</Text>
      </Pressable>
    </View>
  );
}
