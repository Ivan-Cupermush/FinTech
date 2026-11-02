import { ArrowRight, KeyRound, QrCode as QrIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Logo } from '../../ui/Logo';
import { Segmented } from '../../ui/Misc';
import { Backdrop } from '../../ui/fx/Backdrop';
import { Glass } from '../../ui/fx/Glass';
import { QrLogin } from './QrLogin';
import './auth.css';

/** Демо-вход: каждая роль видит свой срез — так проще показать права на питче. */
export const DEMO_PEOPLE = [
  { email: 'director@offix.demo', name: 'Алексей Петров', role: 'Проректор' },
  { email: 'olga@offix.demo', name: 'Ольга Смирнова', role: 'Руководитель офиса' },
  { email: 'dima@offix.demo', name: 'Дмитрий Орлов', role: 'Разработчик' },
  { email: 'anna@offix.demo', name: 'Анна Королёва', role: 'Специалист' },
];
const DEMO_PASSWORD = 'offix-demo';

/** Куда вернуть после входа: только свой адрес, без «//чужой-сайт». */
export function safeNext(next: string | null): string {
  return next && /^\/(?!\/)[^\s]*$/.test(next) && !next.startsWith('/login') ? next : '/app';
}

export function LoginPage() {
  const { token, login, register, applyToken } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [byQr, setByQr] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', company_name: '', display_name: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (token) return <Navigate to={next} replace />;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMessage(null);
    setErrors({});
    try {
      await fn();
      navigate(next);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        setMessage(Object.keys(e.fields).length ? null : e.message);
      } else setMessage('Что-то пошло не так');
    } finally {
      setBusy(null);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'login') {
      const local: Record<string, string> = {};
      if (!form.email.trim()) local.email = 'Введите почту';
      if (!form.password) local.password = 'Введите пароль';
      if (Object.keys(local).length) return setErrors(local);
      void run('form', () => login(form.email, form.password));
    } else {
      void run('form', () => register({ company_name: form.company_name, display_name: form.display_name, email: form.email, password: form.password }));
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="auth">
      <div className="auth-form">
        <Link to="/" aria-label="На главную">
          <Logo size={30} />
        </Link>
        <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
          <h1>{mode === 'login' ? 'С возвращением' : 'Создайте пространство'}</h1>
          <p className="muted">{mode === 'login' ? 'Войдите, чтобы увидеть, как движутся ваши цели.' : 'Компания и вы — владелец. Отделы и команды добавите, когда понадобятся.'}</p>
        </div>
        <Segmented
          label="Вход или регистрация"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setErrors({});
            setMessage(null);
          }}
          options={[
            { value: 'login', label: 'Вход' },
            { value: 'register', label: 'Новая компания' },
          ]}
        />
        {mode === 'login' && byQr ? (
          <>
            <QrLogin onToken={applyToken} />
            <Button variant="ghost" icon={<KeyRound size={16} />} onClick={() => setByQr(false)}>
              По паролю
            </Button>
          </>
        ) : (
        <form className="stack" style={{ '--gap': '16px' } as React.CSSProperties} onSubmit={submit} noValidate>
          {mode === 'register' && (
            <>
              <Field label="Организация" error={errors.company_name}>
                {(p) => <input className="input" {...p} value={form.company_name} onChange={set('company_name')} placeholder="Например, Финансовый университет" autoComplete="organization" />}
              </Field>
              <Field label="Как вас зовут" error={errors.display_name}>
                {(p) => <input className="input" {...p} value={form.display_name} onChange={set('display_name')} placeholder="Имя и фамилия" autoComplete="name" />}
              </Field>
            </>
          )}
          <Field label="Почта" error={errors.email}>
            {(p) => <input className="input" {...p} type="email" value={form.email} onChange={set('email')} placeholder="name@company.ru" autoComplete="email" />}
          </Field>
          <Field label="Пароль" error={errors.password} hint={mode === 'register' ? 'Не короче 8 символов' : undefined}>
            {(p) => <input className="input" {...p} type="password" value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />}
          </Field>
          {message && (
            <div className="field-error" role="alert">
              {message}
            </div>
          )}
          <Button variant="primary" size="lg" type="submit" loading={busy === 'form'} icon={<ArrowRight size={18} />} style={{ flexDirection: 'row-reverse' }}>
            {mode === 'login' ? 'Войти' : 'Создать и начать'}
          </Button>
          {mode === 'login' && (
            <Button variant="ghost" icon={<QrIcon size={16} />} onClick={() => setByQr(true)}>
              По QR-коду с телефона
            </Button>
          )}
        </form>
        )}
        {mode === 'login' && !byQr && (
          <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
            <div className="eyebrow">Демо — войти как</div>
            <div className="demo-people">
              {DEMO_PEOPLE.map((p) => (
                <button key={p.email} type="button" className="demo-person" onClick={() => void run(p.email, () => login(p.email, DEMO_PASSWORD))} disabled={!!busy}>
                  <Avatar name={p.name} size={32} />
                  <span className="grow">
                    <span className="clip" style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>
                      {p.name}
                    </span>
                    <span className="clip faint" style={{ display: 'block', fontSize: 12 }}>
                      {busy === p.email ? 'Входим…' : p.role}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <Backdrop variant="login" framed className="auth-art on-color">
        <div aria-hidden>
          <Glass className="auth-glass" radius={32} elasticity={0.1} clip>
            <div className="auth-glass-body">
              <div className="eyebrow">Время обработки заявки</div>
              <div className="big">
                <span className="dim">40 → </span>36,5
                <span className="dim"> → </span>
                <span className="acc">30</span>
                <span className="dim" style={{ fontSize: '0.4em', letterSpacing: 0 }}>
                  {' '}
                  мин
                </span>
              </div>
              <p>Цель — это изменение показателя, а не список дел. offix показывает, движется ли он, и что мешает.</p>
            </div>
          </Glass>
        </div>
      </Backdrop>
    </div>
  );
}
