import { ArrowRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Logo } from '../../ui/Logo';
import { Segmented } from '../../ui/Misc';
import './auth.css';

/** Демо-вход: каждая роль видит свой срез — так проще показать права на питче. */
export const DEMO_PEOPLE = [
  { email: 'director@offix.demo', name: 'Алексей Петров', role: 'Проректор' },
  { email: 'olga@offix.demo', name: 'Ольга Смирнова', role: 'Руководитель офиса' },
  { email: 'dima@offix.demo', name: 'Дмитрий Орлов', role: 'Разработчик' },
  { email: 'anna@offix.demo', name: 'Анна Королёва', role: 'Специалист' },
];
const DEMO_PASSWORD = 'offix-demo';

export function LoginPage() {
  const { token, login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ email: '', password: '', company_name: '', display_name: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (token) return <Navigate to="/app" replace />;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMessage(null);
    setErrors({});
    try {
      await fn();
      navigate('/app');
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
        </form>
        {mode === 'login' && (
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
      <div className="auth-art" aria-hidden>
        <div className="ring" />
        <div className="ring r2" />
        <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
          <div className="eyebrow" style={{ color: 'color-mix(in srgb, var(--bg) 55%, transparent)' }}>
            Время обработки заявки
          </div>
          <div className="big">
            <span className="dim">40 → </span>36,5
            <span className="dim"> → </span>
            <span className="acc">30</span>
            <span className="dim" style={{ fontSize: '0.4em', letterSpacing: 0 }}>
              {' '}
              мин
            </span>
          </div>
          <p style={{ maxWidth: 420, color: 'color-mix(in srgb, var(--bg) 70%, transparent)', fontSize: 17 }}>
            Цель — это изменение показателя, а не список дел. offix показывает, движется ли он, и что мешает.
          </p>
        </div>
      </div>
    </div>
  );
}
