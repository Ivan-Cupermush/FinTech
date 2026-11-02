import { Bell, BookOpen, Building2, Camera, FileText, LayoutGrid, ListChecks, LogOut, MessagesSquare, Moon, NotebookPen, Plug, Plus, SlidersHorizontal, Sun, Target, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { COMPANY_ROLE_LABELS, isModuleOn, type ModuleKey } from '@offix/core';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { AvatarProvider } from '../lib/avatars';
import { useChatsUnread } from '../features/chats/data';
import { ChatRealtimeProvider } from '../features/chats/realtime';
import { useDashboard, useMe } from '../lib/queries';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Logo } from '../ui/Logo';
import { Glass } from '../ui/fx/Glass';
import { ProfilePhotoDialog } from './ProfilePhoto';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Показывать в нижней панели на телефоне. */
  tab?: boolean;
  /** Только владельцу и администратору. */
  admin?: boolean;
  /** Раздел из «Функций компании»: выключен — пункта нет. */
  module?: ModuleKey;
}

const NAV: NavItem[] = [
  { to: '/app', label: 'Пульс', icon: LayoutGrid, end: true },
  { to: '/app/goals', label: 'Цели', icon: Target },
  { to: '/app/tasks', label: 'Задачи', icon: ListChecks },
  { to: '/app/chats', label: 'Чаты', icon: MessagesSquare, module: 'chats' },
  // На телефоне вкладок шесть: «Эффект» открывается из сводки на Пульсе, отчёт — с экрана «Эффект».
  { to: '/app/metrics', label: 'Эффект', icon: TrendingUp, tab: false },
  { to: '/app/report', label: 'Отчёт', icon: FileText, tab: false },
  { to: '/app/sales', label: 'Продажи', icon: Wallet, tab: false, module: 'sales' },
  { to: '/app/notes', label: 'База знаний', icon: BookOpen, tab: false },
  { to: '/app/my-notes', label: 'Мои заметки', icon: NotebookPen, tab: false, module: 'my_notes' },
  { to: '/app/org', label: 'Организация', icon: Building2 },
  // Интеграции настраивает администратор: остальным пункт не показываем.
  { to: '/app/integrations', label: 'Интеграции', icon: Plug, tab: false, admin: true, module: 'integrations' },
  { to: '/app/notifications', label: 'Уведомления', icon: Bell },
  // Что включено в компании — решает владелец или администратор.
  { to: '/app/company', label: 'Функции компании', icon: SlidersHorizontal, tab: false, admin: true },
];

export function Shell() {
  const { logout } = useAuth();
  const me = useMe();
  const dash = useDashboard();
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();
  const [photo, setPhoto] = useState(false);
  const unread = dash.data?.unread_notifications ?? 0;
  const chatsOn = isModuleOn(me.data?.modules, 'chats');
  const chatsUnread = useChatsUnread(!!me.data && chatsOn).data?.unread ?? 0;
  const admin = me.data?.role === 'owner' || me.data?.role === 'admin';
  const nav = NAV.filter((n) => (!n.admin || admin) && (!n.module || isModuleOn(me.data?.modules, n.module)));
  const { pathname } = useLocation();
  // Открытый чат на телефоне занимает весь экран — нижняя панель прячется.
  const inChat = /^\/app\/chats\/[^/]+/.test(pathname);
  // Непрочитанные — в заголовке вкладки, как в любом мессенджере.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, '');
    document.title = chatsUnread ? `(${chatsUnread > 99 ? '99+' : chatsUnread}) ${base}` : base;
  }, [chatsUnread]);
  const isDark = theme === 'dark' || (theme === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <AvatarProvider enabled={!!me.data}>
    <ChatRealtimeProvider meId={me.data?.id}>
    <div className={`shell ${inChat ? 'is-in-chat' : ''}`}>
      <aside className="sidebar" aria-label="Навигация">
        <div className="sidebar-brand">
          <Logo size={26} />
        </div>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate('/app/goals/new')} style={{ justifyContent: 'flex-start', marginBottom: 14, borderRadius: 12 }}>
          Новая цель
        </Button>
        <nav className="stack" style={{ '--gap': '2px' } as React.CSSProperties}>
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={18} strokeWidth={1.8} />
              {label}
              {to === '/app/notifications' && unread > 0 && <span className="badge">{unread}</span>}
              {to === '/app/chats' && chatsUnread > 0 && <span className="badge is-chat">{chatsUnread > 99 ? '99+' : chatsUnread}</span>}
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
              <button type="button" className="me-photo" onClick={() => setPhoto(true)} aria-label="Фото профиля" title="Сменить фото">
                <Avatar name={me.data.display_name} size={34} id={me.data.id} />
                <span className="me-photo-cam" aria-hidden>
                  <Camera size={11} strokeWidth={2.4} />
                </span>
              </button>
              <Link to="/app/profile" className="grow me-link" title="Профиль, пароль и QR-код">
                <div className="clip" style={{ fontWeight: 600, fontSize: 14 }}>
                  {me.data.display_name}
                </div>
                <div className="clip faint" style={{ fontSize: 12.5 }}>
                  {COMPANY_ROLE_LABELS[me.data.role]} · {me.data.company_name}
                </div>
              </Link>
            </div>
          )}
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
      <Glass className="tabbar-glass" radius={28} overLight={!isDark} elasticity={0} displacement={40} blur={0.25}>
        <nav className="tabbar" aria-label="Навигация">
          {nav.filter((n) => n.tab !== false).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={22} strokeWidth={1.8} />
              {label === 'Организация' ? 'Команда' : label === 'Уведомления' ? 'Входящие' : label}
              {to === '/app/notifications' && unread > 0 && <span className="dot" />}
              {to === '/app/chats' && chatsUnread > 0 && <span className="tab-count">{chatsUnread > 99 ? '99+' : chatsUnread}</span>}
            </NavLink>
          ))}
        </nav>
      </Glass>
      {photo && me.data && <ProfilePhotoDialog me={me.data} onClose={() => setPhoto(false)} />}
    </div>
    </ChatRealtimeProvider>
    </AvatarProvider>
  );
}
