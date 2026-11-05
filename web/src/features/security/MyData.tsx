import { useQuery } from '@tanstack/react-query';
import { Download, FileLock2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, todayIso, type AccountProfile, type LoginEvent } from '@offix/core';
import { ApiError, api, apiBlob, saveBlob } from '../../lib/api';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { LoginList } from './LoginList';

export const myLoginsKey = ['account', 'logins'] as const;
export const exportName = (today: string) => `offix-moi-dannye-${today}.json`;

/** Строка о согласии: когда дано, или что пространство заведено до политики. */
export function consentLine(p: Pick<AccountProfile, 'consent_at'>): string {
  if (p.consent_at) return `Согласие на обработку данных дано ${formatDate(p.consent_at.slice(0, 10), { today: todayIso() })}`;
  return 'Ваш аккаунт создал администратор — данные обрабатываются по договору с организацией';
}

/**
 * «Безопасность и мои данные» в профиле (152-ФЗ, ст. 14): кто входил в мою
 * учётную запись и файл со всем, что offix обо мне хранит.
 */
export function MyData({ profile }: { profile: AccountProfile }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: myLoginsKey, queryFn: () => api<LoginEvent[]>('/account/logins') });
  const logins = q.data ?? [];
  const failed = logins.filter((l) => !l.ok).length;

  const download = async () => {
    setBusy(true);
    try {
      saveBlob(await apiBlob('/account/export'), exportName(todayIso()));
      toast('Файл с вашими данными скачан');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось скачать данные');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card acc-card acc-wide" aria-labelledby="acc-data">
      <h2 id="acc-data" className="acc-h">
        <ShieldCheck size={18} aria-hidden /> Безопасность и мои данные
      </h2>
      <p className="faint acc-note">
        {failed ? `Неудачных попыток входа среди последних: ${failed}. Если это были не вы — смените пароль и выйдите на всех устройствах.` : 'Последние входы в вашу учётную запись. Не узнаёте вход — смените пароль.'}
      </p>
      {q.isLoading ? <Skeleton h={120} /> : <LoginList logins={all ? logins : logins.slice(0, 5)} />}
      {logins.length > 5 && (
        <button type="button" className="mn-link" onClick={() => setAll((v) => !v)}>
          {all ? 'Свернуть' : `Показать все (${logins.length})`}
        </button>
      )}
      <div className="sec-mydata">
        <div className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
          <b>Что offix хранит обо мне</b>
          <span className="faint">Профиль, задачи, сообщения, заметки, файлы и входы — одним файлом. {consentLine(profile)}.</span>
        </div>
        <div className="row sec-mydata-actions">
          <Button icon={<Download size={15} />} onClick={download} loading={busy}>
            Скачать мои данные
          </Button>
          <Link to="/privacy" target="_blank" className="btn btn-ghost">
            <FileLock2 size={15} aria-hidden /> Политика
          </Link>
        </div>
      </div>
    </section>
  );
}
