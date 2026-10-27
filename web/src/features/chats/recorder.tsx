import { ArrowUp, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { VIDEO_NOTE_MAX_SECONDS, VOICE_MAX_SECONDS, dbToLevel, encodeWaveform, recordTimer, resample } from '@offix/core';

export interface Recording {
  file: File;
  duration: number;
  waveform: string | null;
}

const pickType = (list: string[]) => list.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) ?? '';
const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'];
const extOf = (type: string) => (type.includes('mp4') ? (type.startsWith('audio') ? 'm4a' : 'mp4') : type.includes('ogg') ? 'ogg' : 'webm');

export const canRecord = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

/**
 * Запись с микрофона или камеры: MediaRecorder и анализатор громкости.
 * Громкость снимаем 20 раз в секунду — из неё волна для сервера и живые
 * столбики во время записи.
 */
function useRecorder(video: boolean, max: number, onDone: (r: Recording) => void, onError: (msg: string) => void) {
  const [ms, setMs] = useState(0);
  const [live, setLive] = useState<number[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const levels = useRef<number[]>([]);
  const started = useRef(0);
  const cancelled = useRef(false);
  const finish = useRef(onDone);
  finish.current = onDone;

  useEffect(() => {
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let s: MediaStream | null = null;
    let dead = false;
    (async () => {
      try {
        s = await navigator.mediaDevices.getUserMedia(video ? { audio: true, video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } } } : { audio: true });
      } catch {
        onError(video ? 'Нет доступа к камере — разрешите его в настройках браузера' : 'Нет доступа к микрофону — разрешите его в настройках браузера');
        return;
      }
      if (dead) return s.getTracks().forEach((t) => t.stop());
      setStream(s);
      const type = pickType(video ? VIDEO_TYPES : AUDIO_TYPES);
      const r = new MediaRecorder(s, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        s?.getTracks().forEach((t) => t.stop());
        if (cancelled.current) return;
        const duration = (performance.now() - started.current) / 1000;
        const mime = r.mimeType || type || (video ? 'video/webm' : 'audio/webm');
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        const name = `${video ? 'video-note' : 'voice'}.${extOf(mime)}`;
        finish.current({ file: new File([blob], name, { type: blob.type }), duration: Math.max(0.5, Math.round(duration * 10) / 10), waveform: levels.current.length ? encodeWaveform(resample(levels.current, Math.min(100, levels.current.length))) : null });
      };
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) {
          ctx = new AC();
          const an = ctx.createAnalyser();
          an.fftSize = 1024;
          ctx.createMediaStreamSource(s).connect(an);
          const buf = new Float32Array(an.fftSize);
          timer = setInterval(() => {
            an.getFloatTimeDomainData(buf);
            let sum = 0;
            for (const v of buf) sum += v * v;
            const rms = Math.sqrt(sum / buf.length);
            const level = dbToLevel(20 * Math.log10(rms || 1e-8));
            levels.current.push(level);
            setLive((l) => [...l.slice(-47), level]);
          }, 50);
        }
      } catch {
        /* без анализатора — запишем без волны */
      }
      started.current = performance.now();
      r.start(250);
      rec.current = r;
    })();
    const tick = setInterval(() => {
      if (!started.current) return;
      const t = performance.now() - started.current;
      setMs(t);
      if (t >= max * 1000 && rec.current?.state === 'recording') rec.current.stop();
    }, 100);
    return () => {
      dead = true;
      clearInterval(tick);
      if (timer) clearInterval(timer);
      void ctx?.close().catch(() => undefined);
      if (rec.current?.state === 'recording') {
        cancelled.current = true;
        rec.current.stop();
      }
      s?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ms,
    live,
    stream,
    ready: !!stream,
    stop: () => rec.current?.state === 'recording' && rec.current.stop(),
    cancel: () => {
      cancelled.current = true;
      if (rec.current?.state === 'recording') rec.current.stop();
      else stream?.getTracks().forEach((t) => t.stop());
    },
  };
}

/** Голосовое: полоса вместо поля ввода — красная точка, таймер, живая волна. */
export function VoiceRecorder({ onCancel, onDone, onError }: { onCancel: () => void; onDone: (r: Recording) => void; onError: (msg: string) => void }) {
  const r = useRecorder(false, VOICE_MAX_SECONDS, onDone, (m) => (onError(m), onCancel()));
  return (
    <div className="recorder" role="group" aria-label="Запись голосового">
      <button
        type="button"
        className="composer-icon recorder-cancel"
        aria-label="Отменить запись"
        onClick={() => {
          r.cancel();
          onCancel();
        }}
      >
        <Trash2 size={19} />
      </button>
      <span className="recorder-dot" aria-hidden />
      <span className="recorder-time" aria-live="off">
        {recordTimer(r.ms)}
      </span>
      <span className="recorder-wave" aria-hidden>
        {r.live.map((v, i) => (
          <i key={i} style={{ height: `${Math.round(3 + v * 24)}px` }} />
        ))}
      </span>
      <button type="button" className="composer-send is-recording" aria-label="Отправить голосовое" onClick={r.stop} disabled={!r.ready}>
        <ArrowUp size={19} strokeWidth={2.4} />
      </button>
    </div>
  );
}

/** Кружочек: камера в круге посреди экрана, кольцо времени, до минуты. */
export function VideoNoteRecorder({ onCancel, onDone, onError }: { onCancel: () => void; onDone: (r: Recording) => void; onError: (msg: string) => void }) {
  const r = useRecorder(true, VIDEO_NOTE_MAX_SECONDS, onDone, (m) => (onError(m), onCancel()));
  const view = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (view.current && r.stream) view.current.srcObject = r.stream;
  }, [r.stream]);
  const C = 2 * Math.PI * 48;
  const p = Math.min(1, r.ms / (VIDEO_NOTE_MAX_SECONDS * 1000));
  return createPortal(
    <div className="vrec" role="dialog" aria-modal="true" aria-label="Запись видеосообщения">
      <div className="vrec-circle">
        <video ref={view} muted autoPlay playsInline />
        <svg viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="48" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - p) }} />
        </svg>
      </div>
      <div className="vrec-bar wall-glass">
        <button
          type="button"
          className="composer-icon"
          aria-label="Отменить запись"
          onClick={() => {
            r.cancel();
            onCancel();
          }}
        >
          <X size={20} />
        </button>
        <span className="recorder-dot" aria-hidden />
        <span className="recorder-time">{recordTimer(r.ms)}</span>
        <button type="button" className="composer-send is-recording" aria-label="Отправить видеосообщение" onClick={r.stop} disabled={!r.ready}>
          <ArrowUp size={19} strokeWidth={2.4} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
