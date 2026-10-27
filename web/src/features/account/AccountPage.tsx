import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, BookOpen, Camera, ChevronRight, Copy, FileText, KeyRound, LaptopMinimal, LogOut, Mail, Moon, NotebookPen, Pencil, Plug, QrCode as QrIcon, ShieldCheck, Smartphone, Sun, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { COMPANY_ROLE_LABELS, PASSWORD_STRENGTH_LABELS, displayNameError, formatDate, passwordError, passwordStrength, profileUrl, todayIso, type AccountProfile } from '@offix/core';
import { ProfilePhotoDialog } from '../../app/ProfilePhoto';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { copyText } from '../report/files';
import { useMe } from '../../lib/queries';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog, Skeleton } from '../../ui/Misc';
import { QrCode } from '../../ui/QrCode';
import { useToast } from '../../ui/Toast';
import { Glass } from '../../ui/fx/Glass';
import { PageHero } from '../../ui/fx/PageHero';
import { gradientCss, gradientLook } from '../../ui/fx/gradients';
import { useDarkTheme } from '../../ui/fx/support';
import { accountApi, ak, useProfile } from './data';
import { MyFunctions } from './Functions';
import './account.css';

const errFields = (e: unknown) => (e instanceof ApiError ? e.fields : {});
const errText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не получилось, попробуйте ещё раз');
const when = (iso: string | null, empty: string) => (iso ? `${formatDate(iso.slice(0, 10), { today: todayIso() })}, ${new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : empty);

/** Полоска надёжности пароля: четыре деления, цвет — по силе. */
export function StrengthBar({ password }: { password: string }) {
  if (!password) return null;
  const s = passwordStrength(password);
  return (
    <div className="pwd-strength" data-level={s} aria-live="polite">
      <span className="pwd-bars" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className={i <= s ? 'on' : ''} />
        ))}
      </span>
      <span>{PASSWORD_STRENGTH_LABELS[s]}</span>
    </div>
  );
}

function NameForm({ profile, onDone }: { profile: AccountProfile; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(profile.display_name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err = displayNameError(name);
    if (err) return setError(err);
    setBusy(true);
    try {
      qc.setQueryData(ak.profile, await accountApi.rename(name));
      void qc.invalidateQueries({ queryKey: ['me'] });
      toast('Имя сохранено');
      onDone();
    } catch (x) {
      setError(errFields(x).display_name ?? errText(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="acc-inline-form" onSubmit={submit} noValidate>
      <Field label="Как вас видят коллеги" error={error}>
        {(p) => <input className="input" {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
      </Field>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onDone}>
          Отмена
        </Button>
        <Button variant="primary" type="submit" loading={busy}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}

function EmailDialog({ profile, onClose }: { profile: AccountProfile; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState(profile.email);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      qc.setQueryData(ak.profile, await accountApi.email(email, password));
      void qc.invalidateQueries({ queryKey: ['me'] });
      toast('Почта изменена — входите с новой');
      onClose();
    } catch (e) {
      setErrors(Object.keys(errFields(e)).length ? errFields(e) : { email: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Сменить почту"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={busy} disabled={!password} onClick={() => void submit()}>
            Сменить
          </Button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        Почта — это логин. Подтвердите смену паролем.
      </p>
      <Field label="Новая почта" error={errors.email}>
        {(p) => <input className="input" {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
      </Field>
      <Field label="Пароль" error={errors.password}>
        {(p) => <input className="input" {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />}
      </Field>
    </Dialog>
  );
}

function PasswordForm({ profile }: { profile: AccountProfile }) {
  const { applyToken } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!form.current) local.current_password = 'Введите текущий пароль';
    const pe = passwordError(form.next, { email: profile.email, name: profile.display_name });
    if (pe) local.new_password = pe;
    else if (form.next !== form.repeat) local.repeat = 'Пароли не совпадают';
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const r = await accountApi.password(form.current, form.next);
      applyToken(r.token);
      setForm({ current: '', next: '', repeat: '' });
      toast('Пароль изменён. На других устройствах нужно войти заново');
    } catch (x) {
      setErrors(Object.keys(errFields(x)).length ? errFields(x) : { current_password: errText(x) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" style={{ '--gap': '14px' } as React.CSSProperties} onSubmit={submit} noValidate aria-label="Смена пароля">
      <Field label="Текущий пароль" error={errors.current_password}>
        {(p) => <input className="input" {...p} type="password" value={form.current} onChange={set('current')} autoComplete="current-password" />}
      </Field>
      <Field label="Новый пароль" error={errors.new_password} hint="Не короче 8 символов. Фраза из нескольких слов надёжнее «P@ssw0rd».">
        {(p) => <input className="input" {...p} type="password" value={form.next} onChange={set('next')} autoComplete="new-password" />}
      </Field>
      <StrengthBar password={form.next} />
      <Field label="Повторите новый пароль" error={errors.repeat}>
        {(p) => <input className="input" {...p} type="password" value={form.repeat} onChange={set('repeat')} autoComplete="new-password" />}
      </Field>
      <div>
        <Button variant="primary" type="submit" loading={busy} icon={<KeyRound size={15} />}>
          Сменить пароль
        </Button>
      </div>
    </form>
  );
}

function LogoutAllDialog({ onClose }: { onClose: () => void }) {
  const { applyToken, logout } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState<'keep' | 'all' | null>(null);
  const run = async (keep: boolean) => {
    setBusy(keep ? 'keep' : 'all');
    try {
      const r = await accountApi.logoutAll(keep);
      if (r.token) {
        applyToken(r.token);
        toast('Другие устройства вышли из offix');
        onClose();
      } else logout();
    } catch (e) {
      toast(errText(e), 'error');
      setBusy(null);
    }
  };
  return (
    <Dialog
      title="Выйти на всех устройствах?"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" loading={busy === 'all'} disabled={!!busy} onClick={() => void run(false)}>
            И здесь тоже
          </Button>
          <Button variant="danger" loading={busy === 'keep'} disabled={!!busy} onClick={() => void run(true)}>
            Выйти на остальных
          </Button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        Телефон, рабочий компьютер, браузер в переговорной — все сеансы закроются сразу. Пригодится, если потеряли телефон или вошли на чужом компьютере.
      </p>
    </Dialog>
  );
}

/** Мой QR-код: коллега наводит камеру — открывается моя карточка. */
export function ProfileQr({ id, name }: { id: string; name: string }) {
  const dark = useDarkTheme();
  const toast = useToast();
  const url = profileUrl(window.location.origin, id);
  return (
    <div className="acc-qr" style={{ background: gradientCss(gradientLook('profile', dark)) }}>
      <Glass className="acc-qr-glass" radius={28} elasticity={0} displacement={40} blur={0.3} clip>
        <div className="acc-qr-body">
          <QrCode value={url} size={196} label={`QR-код профиля: ${name}`} />
          <div className="acc-qr-text">
            <b>{name}</b>
            <span>Наведите камеру — откроется карточка: написать, сохранить, добавить в группу.</span>
          </div>
          <button
            type="button"
            className="acc-qr-copy"
            onClick={async () => {
              if (await copyText(url)) toast('Ссылка на профиль скопирована');
            }}
          >
            <Copy size={14} aria-hidden /> Скопировать ссылку
          </button>
        </div>
      </Glass>
    </div>
  );
}

/**
 * Профиль: имя, фото, почта, пароль, сеансы и свой QR-код. На телефоне здесь
 * же — разделы, которым не хватило места в нижней панели.
 */
export function AccountPage() {
  const q = useProfile();
  const me = useMe();
  const { logout } = useAuth();
  const [, toggleTheme] = useTheme();
  const dark = useDarkTheme();
  const [editName, setEditName] = useState(false);
  const [dialog, setDialog] = useState<'email' | 'logout' | 'photo' | null>(null);
  const p = q.data;
  const admin = p?.role === 'owner' || p?.role === 'admin';

  if (q.isLoading || !p) return <div className="page"><Skeleton h={320} /></div>;
  return (
    <div className="page acc-page" style={{ maxWidth: 1080 }}>
      <PageHero
        variant="profile"
        icon={UserRound}
        eyebrow="Профиль"
        title={p.display_name}
        subtitle={`${COMPANY_ROLE_LABELS[p.role]} · ${p.company_name}${p.position ? ` · ${p.position}` : ''}`}
        stats={[
          { label: 'в offix с', value: formatDate(p.joined_at.slice(0, 10), { short: true, today: todayIso() }) },
          { label: 'последний вход', value: p.last_login_at ? formatDate(p.last_login_at.slice(0, 10), { short: true, today: todayIso() }) : '—' },
        ]}
      />
      <div className="acc-grid">
        <section className="card acc-card" aria-labelledby="acc-me">
          <h2 id="acc-me" className="acc-h">
            <UserRound size={18} aria-hidden /> Обо мне
          </h2>
          <div className="acc-me">
            <button type="button" className="me-photo acc-photo" onClick={() => setDialog('photo')} aria-label="Сменить фото" title="Сменить фото">
              <Avatar name={p.display_name} size={72} id={p.id} />
              <span className="me-photo-cam" aria-hidden>
                <Camera size={13} strokeWidth={2.4} />
              </span>
            </button>
            {editName ? (
              <div className="grow">
                <NameForm profile={p} onDone={() => setEditName(false)} />
              </div>
            ) : (
              <div className="grow acc-me-text">
                <b>{p.display_name}</b>
                <span className="faint">{p.position ?? 'Должность назначает администратор'}</span>
                <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setEditName(true)}>
                  Изменить имя
                </Button>
              </div>
            )}
          </div>
          <dl className="acc-facts">
            <div>
              <dt>
                <Mail size={14} aria-hidden /> Почта
              </dt>
              <dd>
                <span className="clip">{p.email}</span>
                <button type="button" className="mn-link" onClick={() => setDialog('email')}>
                  Сменить
                </button>
              </dd>
            </div>
            <div>
              <dt>
                <ShieldCheck size={14} aria-hidden /> Роль
              </dt>
              <dd>{COMPANY_ROLE_LABELS[p.role]}</dd>
            </div>
          </dl>
        </section>

        <section className="card acc-card" aria-labelledby="acc-qr">
          <h2 id="acc-qr" className="acc-h">
            <QrIcon size={18} aria-hidden /> Мой QR-код
          </h2>
          <ProfileQr id={p.id} name={p.display_name} />
        </section>

        <MyFunctions />

        <section className="card acc-card" aria-labelledby="acc-sec">
          <h2 id="acc-sec" className="acc-h">
            <KeyRound size={18} aria-hidden /> Пароль
          </h2>
          <p className="faint acc-note">{p.password_changed_at ? `Последняя смена — ${when(p.password_changed_at, '')}` : 'Пароль ещё не меняли. Если вам выдали временный — смените его.'}</p>
          <PasswordForm profile={p} />
        </section>

        <section className="card acc-card" aria-labelledby="acc-sessions">
          <h2 id="acc-sessions" className="acc-h">
            <LaptopMinimal size={18} aria-hidden /> Сеансы и вход
          </h2>
          <p className="faint acc-note">Последний вход — {when(p.last_login_at, 'ещё не было')}</p>
          <div className="acc-howto">
            <Smartphone size={20} aria-hidden />
            <p>
              <b>Вход на компьютере без пароля.</b> На странице входа выберите «По QR-коду» и наведите камеру телефона или приложения offix. Вход подтверждается на телефоне — сфотографировать код с экрана бесполезно.
            </p>
          </div>
          <div>
            <Button variant="danger" icon={<LogOut size={15} />} onClick={() => setDialog('logout')}>
              Выйти на всех устройствах
            </Button>
          </div>
        </section>
      </div>

      <nav className="card card-tight list acc-menu" aria-label="Разделы">
        <Link className="list-row" to="/app/my-notes">
          <NotebookPen size={18} aria-hidden /> <span className="grow">Мои заметки</span> <ChevronRight size={16} className="faint" aria-hidden />
        </Link>
        <Link className="list-row" to="/app/notes">
          <BookOpen size={18} aria-hidden /> <span className="grow">База знаний</span> <ChevronRight size={16} className="faint" aria-hidden />
        </Link>
        <Link className="list-row" to="/app/metrics">
          <BarChart3 size={18} aria-hidden /> <span className="grow">Эффект</span> <ChevronRight size={16} className="faint" aria-hidden />
        </Link>
        <Link className="list-row" to="/app/report">
          <FileText size={18} aria-hidden /> <span className="grow">Отчёт</span> <ChevronRight size={16} className="faint" aria-hidden />
        </Link>
        {admin && (
          <Link className="list-row" to="/app/integrations">
            <Plug size={18} aria-hidden /> <span className="grow">Интеграции</span> <ChevronRight size={16} className="faint" aria-hidden />
          </Link>
        )}
        <button type="button" className="list-row" onClick={toggleTheme}>
          {dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />} <span className="grow">{dark ? 'Светлая тема' : 'Тёмная тема'}</span>
        </button>
        <button type="button" className="list-row acc-logout" onClick={logout}>
          <LogOut size={18} aria-hidden /> <span className="grow">Выйти</span>
        </button>
      </nav>

      {dialog === 'email' && <EmailDialog profile={p} onClose={() => setDialog(null)} />}
      {dialog === 'logout' && <LogoutAllDialog onClose={() => setDialog(null)} />}
      {dialog === 'photo' && me.data && <ProfilePhotoDialog me={me.data} onClose={() => setDialog(null)} />}
    </div>
  );
}
