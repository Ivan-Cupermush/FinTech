import { CheckCircle2, LaptopMinimal, MonitorSmartphone, ShieldAlert, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { isQrLoginToken, type QrLoginInfo } from '@offix/core';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { Logo } from '../../ui/Logo';
import { Backdrop } from '../../ui/fx/Backdrop';
import { Glass } from '../../ui/fx/Glass';
import { accountApi } from './data';
import './account.css';

type View = { kind: 'loading' } | { kind: 'info'; info: QrLoginInfo } | { kind: 'error'; title: string; text: string };

function errorView(e: unknown): View {
  if (e instanceof ApiError && e.status === 403) return { kind: 'error', title: 'Код уже занят', text: 'Этот код отсканировал другой человек. Если это были не вы — просто закройте страницу: без подтверждения вход не выдаётся.' };
  if (e instanceof ApiError && e.status === 409) return { kind: 'error', title: 'Код устарел', text: 'Обновите страницу входа на компьютере и отсканируйте новый код.' };
  if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return { kind: 'error', title: 'Код не найден', text: 'Обновите страницу входа на компьютере и отсканируйте новый код.' };
  return { kind: 'error', title: 'Не получилось', text: e instanceof ApiError ? e.message : 'Нет связи с сервером. Попробуйте ещё раз.' };
}

/**
 * Телефон отсканировал код входа: показываем, какое устройство просит вход,
 * и ждём явного «Подтвердить». Без него компьютер сеанса не получит.
 */
export function QrConfirmPage() {
  const { token: code = '' } = useParams();
  const { token } = useAuth();
  const { pathname } = useLocation();
  const me = useMe(!!token);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const valid = isQrLoginToken(code);

  useEffect(() => {
    if (!token || !valid) return;
    let live = true;
    accountApi
      .qrInfo(code)
      .then((info) => live && setView({ kind: 'info', info }))
      .catch((e) => live && setView(errorView(e)));
    return () => {
      live = false;
    };
  }, [token, code, valid]);

  if (!token) return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} replace />;

  const answer = async (how: 'approve' | 'decline') => {
    setBusy(how);
    try {
      const info = how === 'approve' ? await accountApi.qrApprove(code) : await accountApi.qrDecline(code);
      setView({ kind: 'info', info });
    } catch (e) {
      setView(errorView(e));
    } finally {
      setBusy(null);
    }
  };

  const current: View = valid ? view : { kind: 'error', title: 'Это не код входа offix', text: 'Проверьте, что сканируете код со страницы входа offix.' };
  const info = current.kind === 'info' ? current.info : null;
  const waiting = info && (info.status === 'scanned' || info.status === 'pending');

  return (
    <Backdrop variant="login" framed className="qr-confirm on-color">
      <div className="qr-confirm-inner">
        <Link to="/app" aria-label="offix" className="qr-confirm-logo">
          <Logo size={26} />
        </Link>
        <Glass className="qr-confirm-glass" radius={30} elasticity={0} displacement={44} blur={0.3} clip>
          <div className="qr-confirm-body" aria-live="polite">
            {current.kind === 'loading' && <p>Проверяем код…</p>}
            {current.kind === 'error' && (
              <>
                <ShieldAlert size={40} aria-hidden />
                <h1>{current.title}</h1>
                <p>{current.text}</p>
                <Link to="/app" className="qr-confirm-link">
                  Открыть offix
                </Link>
              </>
            )}
            {info && waiting && (
              <>
                <span className="qr-confirm-icon" aria-hidden>
                  {info.device.kind === 'phone' || info.device.kind === 'tablet' ? <MonitorSmartphone size={30} /> : <LaptopMinimal size={30} />}
                </span>
                <h1>Войти в offix на этом устройстве?</h1>
                <dl className="qr-confirm-facts">
                  <div>
                    <dt>Устройство</dt>
                    <dd>{info.device.label}</dd>
                  </div>
                  {info.ip && (
                    <div>
                      <dt>IP-адрес</dt>
                      <dd className="num">{info.ip}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Аккаунт</dt>
                    <dd>{me.data ? `${me.data.display_name} · ${me.data.company_name}` : '…'}</dd>
                  </div>
                </dl>
                <p className="qr-confirm-warn">Подтверждайте, только если сами открыли страницу входа на этом компьютере. Никому не пересылайте эту ссылку.</p>
                <div className="qr-confirm-actions">
                  <Button variant="ghost" size="lg" loading={busy === 'decline'} disabled={!!busy} icon={<XCircle size={16} />} onClick={() => void answer('decline')}>
                    Отклонить
                  </Button>
                  <Button variant="primary" size="lg" loading={busy === 'approve'} disabled={!!busy} icon={<CheckCircle2 size={18} />} onClick={() => void answer('approve')}>
                    Подтвердить вход
                  </Button>
                </div>
              </>
            )}
            {info && !waiting && (
              <>
                {info.status === 'approved' ? <CheckCircle2 size={40} aria-hidden /> : <XCircle size={40} aria-hidden />}
                <h1>{info.status === 'approved' ? 'Вход подтверждён' : info.status === 'declined' ? 'Вход отклонён' : 'Код устарел'}</h1>
                <p>{info.status === 'approved' ? `На устройстве «${info.device.label}» открывается offix.` : info.status === 'declined' ? 'Компьютер не получил доступ к вашему аккаунту.' : 'Обновите страницу входа на компьютере и отсканируйте новый код.'}</p>
                <Link to="/app" className="qr-confirm-link">
                  Открыть offix
                </Link>
              </>
            )}
          </div>
        </Glass>
      </div>
    </Backdrop>
  );
}
