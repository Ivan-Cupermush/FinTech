import { Camera, CheckCircle2, RefreshCw, Smartphone, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { qrLoginUrl, type QrPollResult } from '@offix/core';
import { ApiError, api } from '../../lib/api';
import { Button } from '../../ui/Button';
import { QrCode } from '../../ui/QrCode';
import { Glass } from '../../ui/fx/Glass';
import '../account/account.css';
import { gradientCss, gradientLook } from '../../ui/fx/gradients';

interface Code {
  token: string;
  secret: string;
  expires_at: string;
  ttl: number;
}

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'live'; code: Code; poll: QrPollResult } | { kind: 'stopped'; code: Code; reason: 'declined' | 'expired' };

const POLL_MS = 1500;
/** Сколько раз подряд обновляем код сами: дальше — по кнопке, вкладку могли забыть. */
const AUTO_REFRESH = 6;

/**
 * Вход по QR, как в Telegram Web: сайт показывает одноразовый код, телефон
 * с offix его сканирует и подтверждает. Сайт получает вход ровно один раз —
 * по secret, который знает только эта вкладка.
 */
export function QrLogin({ onToken }: { onToken: (token: string) => void }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [left, setLeft] = useState(0);
  const refreshes = useRef(0);
  const done = useRef(onToken);
  done.current = onToken;
  const look = gradientLook('login', false);

  const fresh = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const code = await api<Code>('/auth/qr', { body: {} });
      setState({ kind: 'live', code, poll: { status: 'pending' } });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof ApiError ? e.message : 'Не удалось получить код' });
    }
  }, []);

  useEffect(() => {
    void fresh();
  }, [fresh]);

  const live = state.kind === 'live' ? state.code : null;
  useEffect(() => {
    if (!live) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stop) return;
      setLeft(Math.max(0, Math.round((Date.parse(live.expires_at) - Date.now()) / 1000)));
      if (document.visibilityState !== 'hidden') {
        try {
          const poll = await api<QrPollResult>('/auth/qr/poll', { body: { token: live.token, secret: live.secret } });
          if (stop) return;
          if (poll.status === 'approved') {
            done.current(poll.token);
            return;
          }
          if (poll.status === 'declined' || poll.status === 'expired') {
            if (poll.status === 'expired' && refreshes.current < AUTO_REFRESH) {
              refreshes.current += 1;
              void fresh();
            } else setState({ kind: 'stopped', code: live, reason: poll.status });
            return;
          }
          setState((s) => (s.kind === 'live' && s.code === live ? { ...s, poll } : s));
        } catch {
          // Сеть моргнула — попробуем на следующем такте.
        }
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [live, fresh]);

  const scanned = state.kind === 'live' && state.poll.status === 'scanned' ? state.poll.user.display_name : null;
  const value = state.kind === 'live' || state.kind === 'stopped' ? qrLoginUrl(window.location.origin, state.code.token) : null;
  const restart = () => {
    refreshes.current = 0;
    void fresh();
  };

  return (
    <div className="qr-login">
      <div className="qr-login-stage" style={{ background: gradientCss(look) }}>
        <Glass className="qr-login-glass" radius={30} elasticity={0} displacement={44} blur={0.3} clip>
          <div className="qr-login-code">
            {value ? <QrCode value={value} size={208} label="QR-код для входа" faded={!!scanned || state.kind === 'stopped'} /> : <div className="qr-login-blank" aria-hidden />}
            {scanned && (
              <div className="qr-login-over" role="status">
                <CheckCircle2 size={34} aria-hidden />
                <b>{scanned.split(' ')[0]}, подтвердите вход на телефоне</b>
              </div>
            )}
            {state.kind === 'stopped' && (
              <div className="qr-login-over" role="status">
                {state.reason === 'declined' ? <XCircle size={34} aria-hidden /> : <RefreshCw size={30} aria-hidden />}
                <b>{state.reason === 'declined' ? 'Вход отклонён на телефоне' : 'Код устарел'}</b>
                <Button size="sm" onClick={restart} icon={<RefreshCw size={14} />}>
                  Новый код
                </Button>
              </div>
            )}
          </div>
        </Glass>
        {state.kind === 'live' && !scanned && (
          <span className="qr-login-timer num" aria-label={`Код обновится через ${left} с`}>
            {left} с
          </span>
        )}
      </div>
      {state.kind === 'error' ? (
        <div className="field-error" role="alert">
          {state.message}
          <Button size="sm" variant="ghost" onClick={restart}>
            Повторить
          </Button>
        </div>
      ) : (
        <ol className="qr-login-steps">
          <li>
            <Smartphone size={16} aria-hidden /> Откройте offix на телефоне
          </li>
          <li>
            <Camera size={16} aria-hidden /> Профиль → «Сканировать QR» или просто камера телефона
          </li>
          <li>
            <CheckCircle2 size={16} aria-hidden /> Подтвердите вход — и здесь откроется offix
          </li>
        </ol>
      )}
    </div>
  );
}
