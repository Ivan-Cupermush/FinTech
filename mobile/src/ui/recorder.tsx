import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { ArrowUp, Square, Trash2, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { recordTimer, VIDEO_NOTE_MAX_SECONDS, VOICE_MAX_SECONDS } from '@offix/core';
import { LevelTrack, type PickedFile } from '../lib/media';
import { font } from '../lib/theme';
import { useWall } from './chats';
import { Text } from './primitives';

export interface Recording {
  file: PickedFile;
  duration: number;
  waveform?: string;
}

const BARS = 34;

/** Мигающая красная точка «идёт запись». */
function RecDot() {
  const a = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(a, { toValue: 0.25, duration: 600, useNativeDriver: true }), Animated.timing(a, { toValue: 1, duration: 600, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [a]);
  return <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff4d5a', opacity: a }} />;
}

/**
 * Запись голосового прямо в поле ввода: живая волна, таймер, «удалить» и
 * «отправить». Громкость с микрофона копится в волну для собеседника.
 */
export function VoiceRecorderBar({ onCancel, onDone }: { onCancel: () => void; onDone: (r: Recording) => void }) {
  const w = useWall();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 80);
  const track = useRef(new LevelTrack());
  const [ready, setReady] = useState(false);
  const finishing = useRef(false);
  const [, tick] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Нет доступа к микрофону', 'Разрешите offix пользоваться микрофоном в настройках телефона.');
        return live && onCancel();
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!live) return;
      recorder.record();
      setReady(true);
    })().catch((e) => {
      Alert.alert('Запись не началась', e instanceof Error ? e.message : 'Попробуйте ещё раз');
      if (live) onCancel();
    });
    return () => {
      live = false;
      if (recorder.isRecording) void recorder.stop().catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!state.isRecording) return;
    track.current.push(state.metering);
    tick((n) => n + 1);
  }, [state.durationMillis, state.isRecording, state.metering]);

  const finish = async (send: boolean) => {
    if (finishing.current) return;
    finishing.current = true;
    const ms = state.durationMillis;
    await recorder.stop().catch(() => undefined);
    const uri = recorder.uri;
    if (!send || !uri || ms < 700) return onCancel();
    const web = Platform.OS === 'web';
    onDone({
      file: { key: uri, uri, name: web ? 'voice.webm' : 'voice.m4a', mime: web ? 'audio/webm' : 'audio/mp4', size: null, duration: ms / 1000 },
      duration: ms / 1000,
      waveform: track.current.encode() || undefined,
    });
  };

  useEffect(() => {
    if (state.durationMillis >= VOICE_MAX_SECONDS * 1000) void finish(true);
  }, [state.durationMillis]); // eslint-disable-line react-hooks/exhaustive-deps

  const levels = track.current.tail(BARS);
  return (
    <View accessibilityLabel="Запись голосового" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 6, paddingLeft: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Удалить запись" onPress={() => void finish(false)} hitSlop={8} style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }}>
        <Trash2 size={20} color="#e0464c" />
      </Pressable>
      <RecDot />
      <Text style={{ color: w.ink, fontFamily: font.semibold, fontVariant: ['tabular-nums'], width: 58 }}>{recordTimer(state.durationMillis)}</Text>
      <View style={{ flex: 1, height: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2, overflow: 'hidden' }}>
        {levels.map((v, i) => (
          <View key={i} style={{ width: 3, height: Math.max(3, Math.round(v * 28)), borderRadius: 2, backgroundColor: '#3b5bff', opacity: 0.35 + (i / BARS) * 0.65 }} />
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Отправить голосовое"
        disabled={!ready}
        onPress={() => void finish(true)}
        style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3b5bff', opacity: ready ? 1 : 0.5, transform: [{ scale: pressed ? 0.92 : 1 }], shadowColor: '#2f4bff', shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } })}
      >
        <ArrowUp size={20} color="#fff" strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

const CIRCLE = 280;

/**
 * Кружочек: фронтальная камера в круге, кольцо показывает, сколько осталось
 * до минуты. Касание — начать, ещё касание — остановить и отправить.
 */
export function VideoNoteRecorder({ onClose, onDone }: { onClose: () => void; onDone: (r: Recording) => void }) {
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);
  const [cam, askCam] = useCameraPermissions();
  const [mic, askMic] = useMicrophonePermissions();
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    void (async () => {
      const c = cam?.granted ? cam : await askCam();
      const m = mic?.granted ? mic : await askMic();
      if (!c.granted || !m.granted) {
        Alert.alert('Нет доступа', 'Для кружочка нужны камера и микрофон — разрешите их в настройках телефона.');
        onClose();
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (started === null) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [started]);

  const elapsed = started === null ? 0 : Math.max(0, now - started);
  const start = () => {
    if (!camera.current || started !== null) return;
    const t0 = Date.now();
    setStarted(t0);
    setNow(t0);
    camera.current
      .recordAsync({ maxDuration: VIDEO_NOTE_MAX_SECONDS })
      .then((v) => {
        const sec = (Date.now() - t0) / 1000;
        if (!v?.uri || sec < 1) return onClose();
        onDone({ file: { key: v.uri, uri: v.uri, name: 'note.mp4', mime: 'video/mp4', size: null, duration: sec }, duration: sec });
      })
      .catch((e) => {
        Alert.alert('Запись не удалась', e instanceof Error ? e.message : 'Попробуйте ещё раз');
        onClose();
      });
  };

  const r = CIRCLE / 2 + 6;
  const len = 2 * Math.PI * r;
  const p = Math.min(1, elapsed / (VIDEO_NOTE_MAX_SECONDS * 1000));
  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#05061a', alignItems: 'center', justifyContent: 'center', paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={() => (started !== null ? camera.current?.stopRecording() : onClose())} style={{ position: 'absolute', top: insets.top + 12, left: 16, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' }}>
          <X size={20} color="#fff" />
        </Pressable>
        <View style={{ width: CIRCLE + 24, height: CIRCLE + 24, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, overflow: 'hidden', backgroundColor: '#0d1030' }}>
            {cam?.granted && mic?.granted && <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" mode="video" mirror onCameraReady={() => setReady(true)} />}
          </View>
          <Svg width={CIRCLE + 24} height={CIRCLE + 24} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Circle cx={(CIRCLE + 24) / 2} cy={(CIRCLE + 24) / 2} r={r} stroke="rgba(255,255,255,0.18)" strokeWidth={4} fill="none" />
            {started !== null && <Circle cx={(CIRCLE + 24) / 2} cy={(CIRCLE + 24) / 2} r={r} stroke="#ff4d5a" strokeWidth={4} fill="none" strokeLinecap="round" strokeDasharray={`${len} ${len}`} strokeDashoffset={len * (1 - p)} transform={`rotate(-90 ${(CIRCLE + 24) / 2} ${(CIRCLE + 24) / 2})`} />}
          </Svg>
        </View>
        <View style={{ height: 28, marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {started !== null && <RecDot />}
          <Text style={{ color: '#fff', fontFamily: font.semibold, fontVariant: ['tabular-nums'] }}>{started !== null ? recordTimer(elapsed) : 'Видеосообщение до минуты'}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={started !== null ? 'Остановить и отправить' : 'Начать запись'}
          disabled={!ready}
          onPress={() => (started !== null ? camera.current?.stopRecording() : start())}
          style={({ pressed }) => ({ marginTop: 28, width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', opacity: ready ? 1 : 0.5, transform: [{ scale: pressed ? 0.94 : 1 }] })}
        >
          {started !== null ? <Square size={26} color="#ff4d5a" fill="#ff4d5a" /> : <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: '#ff4d5a' }} />}
        </Pressable>
      </View>
    </Modal>
  );
}
