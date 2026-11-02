import { ToggleRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { isModuleOn, moduleInfo, type ModuleKey } from '@offix/core';
import { useMe } from './queries';
import { Empty } from '../ui/Misc';
import '../features/company/company.css';

/**
 * Включён ли раздел в компании. Пока профиль грузится — считаем выключенным:
 * кнопка раздела появится через миг, зато выключенный раздел не мелькнёт.
 */
export function useModuleOn(key: ModuleKey): boolean {
  const me = useMe();
  return !!me.data && isModuleOn(me.data.modules, key);
}

/** Страница выключенного раздела: прямая ссылка или старая закладка. */
export function ModuleOff({ module }: { module: ModuleKey }) {
  const me = useMe();
  const admin = me.data?.role === 'owner' || me.data?.role === 'admin';
  const info = moduleInfo(module);
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="card module-off">
        <Empty
          icon={<ToggleRight size={22} />}
          title="Раздел выключен"
          action={
            admin ? (
              <Link className="btn btn-primary" to="/app/company">
                Функции компании
              </Link>
            ) : (
              <Link className="btn" to="/app">
                На Пульс
              </Link>
            )
          }
        >
          «{info.title}» в вашей компании не используется.{' '}
          {admin ? 'Включить раздел можно в «Функциях компании».' : 'Если он нужен, попросите владельца или администратора включить его в «Функциях компании».'}
        </Empty>
      </div>
    </div>
  );
}

/** Обёртка маршрута: раздел выключен — вместо него «Раздел выключен». */
export function ModuleGate({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const me = useMe();
  // Пока не знаем, включён ли раздел, — ничего не грузим: выключенный раздел не должен даже спрашивать сервер.
  if (!me.data) return me.isError ? <>{children}</> : null;
  if (!isModuleOn(me.data.modules, module)) return <ModuleOff module={module} />;
  return <>{children}</>;
}
