import { CircleAlert, KeyRound, LogIn, QrCode, UserPlus } from 'lucide-react';
import { LOGIN_FAILURE_LABELS, LOGIN_METHOD_LABELS, formatDate, todayIso, type LoginEvent, type LoginMethod } from '@offix/core';
import { Pill } from '../../ui/Pill';
import './security.css';

const METHOD_ICON: Record<LoginMethod, typeof KeyRound> = { password: KeyRound, qr: QrCode, register: UserPlus };

/** «2 ноября, 21:14» — по часам того, кто смотрит. */
export const loginMoment = (iso: string) => `${formatDate(iso.slice(0, 10), { today: todayIso() })}, ${new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;

/**
 * Журнал входов: в профиле — свои, в «Безопасности» — все в компании
 * (`who` показывает, кто входил). Неудачные попытки видно сразу — красным.
 */
export function LoginList({ logins, who = false, empty = 'Входов пока не было' }: { logins: LoginEvent[]; who?: boolean; empty?: string }) {
  if (!logins.length) return <p className="faint sec-empty">{empty}</p>;
  return (
    <ul className="sec-logins" aria-label="Входы">
      {logins.map((l) => {
        const Icon = l.ok ? (METHOD_ICON[l.method] ?? LogIn) : CircleAlert;
        return (
          <li key={l.id} className={`sec-login ${l.ok ? '' : 'is-failed'}`}>
            <span className="sec-login-icon" aria-hidden>
              <Icon size={16} />
            </span>
            <span className="grow stack sec-login-text">
              <span className="sec-login-title">
                {who && <b>{l.display_name ?? 'Неизвестная почта'} · </b>}
                {l.ok ? LOGIN_METHOD_LABELS[l.method] : LOGIN_FAILURE_LABELS[l.failure ?? 'bad_password']}
              </span>
              <span className="faint sec-login-meta">
                {loginMoment(l.at)} · {l.device}
                {l.ip ? ` · ${l.ip}` : ''}
              </span>
            </span>
            {!l.ok && <Pill tone="bad">не вошёл</Pill>}
          </li>
        );
      })}
    </ul>
  );
}
