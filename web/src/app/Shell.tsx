import { Bell, BookOpen, Building2, FileText, LayoutGrid, ListChecks, LogOut, Moon, Plug, Plus, Sun, Target, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { COMPANY_ROLE_LABELS } from '@offix/core';
import { useAuth } from '../lib/auth';
import { useDashboard, useMe } from '../lib/queries';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Logo } from '../ui/Logo';
import { Glass } from '../ui/fx/Glass';

const NAV = [
  { to: '/app', label: 'Пульс', icon: LayoutGrid, end: true },
  { to: '/app/goals', label: 'Цели', icon: Target },
  { to: '/app/tasks', label: 'Задачи', icon: ListChecks },
  // На телефоне вкладок пять: «Эффект» открывается из сводки на Пульсе, отчёт — с экрана «Эффект».
  { to: '/app/metrics', label: 'Эффект', icon: TrendingUp, tab: false },
  { to: '/app/report', label: 'Отчёт', icon: FileText, tab: false },
  { to: '/app/notes', label: 'База знаний', icon: BookOpen, tab: false },
  { to: '/app/org', label: 'Организация', icon: Building2 },
  // Интеграции настраивает администратор: остальным пункт не показываем.
  { to: '/app/integrations', label: 'Интеграции', icon: Plug, tab: false, admin: true },
  { to: '/app/notifications', label: 'Уведомления', icon: Bell },
];

type Theme = 'system' | 'light' | 'dark';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('offix.theme') as Theme) || 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('offix.theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return [theme, toggle];
}

export function Shell() {
  const { logout } = useAuth();
  const me = useMe();
  const dash = useDashboard();
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();
  const unread = dash.data?.unread_notifications ?? 0;
  const isDark = theme === 'dark' || (theme === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Навигация">
        <div className="sidebar-brand">
          <Logo size={26} />
        </div>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate('/app/goals/new')} style={{ justifyContent: 'flex-start', marginBottom: 14, borderRadius: 12 }}>
          Новая цель
        </Button>
        <nav className="stack" style={{ '--gap': '2px' } as React.CSSProperties}>
          {NAV.filter((n) => !n.admin || me.data?.role === 'owner' || me.data?.role === 'admin').map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={18} strokeWidth={1.8} />
              {label}
              {to === '/app/notifications' && unread > 0 && <span className="badge">{unread}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="row" style={{ gap: 4 }}>
            <Button variant="ghost" size="sm" icon={isDark ? <Sun size={16} /> : <Moon size={16} />} onClick={toggleTheme} aria-label="Сменить тему" />
            <Button variant="ghost" size="sm" icon={<LogOut size={16} />} onClick={logout} aria-label="Выйти" />
          </div>
          {me.data && (
            <div className="me-card">
              <Avatar name={me.data.display_name} size={34} />
              <div className="grow">
                <div className="clip" style={{ fontWeight: 600, fontSize: 14 }}>
                  {me.data.display_name}
                </div>
                <div className="clip faint" style={{ fontSize: 12.5 }}>
                  {COMPANY_ROLE_LABELS[me.data.role]} · {me.data.company_name}
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
      <Glass className="tabbar-glass" radius={28} overLight={!isDark} elasticity={0} displacement={40} blur={0.25}>
        <nav className="tabbar" aria-label="Навигация">
          {NAV.filter((n) => n.tab !== false).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={22} strokeWidth={1.8} />
              {label === 'Организация' ? 'Команда' : label === 'Уведомления' ? 'Входящие' : label}
              {to === '/app/notifications' && unread > 0 && <span className="dot" />}
            </NavLink>
          ))}
        </nav>
      </Glass>
    </div>
  );
}
