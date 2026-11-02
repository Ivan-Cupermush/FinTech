import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FlaskConical } from 'lucide-react';
import { COMPANY_ROLE_LABELS, type SandboxInfo, type SandboxPerson } from '@offix/core';
import { api } from '../../lib/api';
import { Avatar } from '../../ui/Avatar';
import { Glass } from '../../ui/fx/Glass';

/**
 * Песочница для жюри: сервер запущен с OFFIX_SANDBOX=1 — на странице входа
 * список готовых сотрудников. Без песочницы запрос вернёт enabled: false,
 * а при ошибке сети карточки просто нет.
 */
export const useSandbox = () =>
  useQuery({ queryKey: ['sandbox'], queryFn: () => api<SandboxInfo>('/auth/sandbox'), staleTime: Infinity, retry: false, select: (d) => (d.enabled && d.people.length ? d : null) });

export function SandboxCard({ info, busy, onPick }: { info: SandboxInfo; busy: string | null; onPick: (p: SandboxPerson) => void }) {
  return (
    <Glass className="sbx-glass" radius={30} elasticity={0} displacement={44} blur={0.3} clip>
      <section className="sbx" aria-labelledby="sbx-h">
        <div className="sbx-top">
          <span className="sbx-badge" aria-hidden>
            <FlaskConical size={18} />
          </span>
          <div className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
            <div className="eyebrow">Песочница для жюри</div>
            <h2 id="sbx-h">{info.company_name ?? 'Университет'}</h2>
          </div>
        </div>
        <p className="sbx-lead">
          Готовый университет с целями, задачами, чатами и базой знаний. Продажи и выплаты выключены — университету они не нужны. Нажмите на сотрудника, чтобы войти; пароль совпадает с логином.
        </p>
        <ul className="sbx-people">
          {info.people.map((p) => (
            <li key={p.login}>
              <button type="button" className="sbx-person" onClick={() => onPick(p)} disabled={!!busy} aria-label={`Войти: ${p.display_name}, ${p.position}. Логин ${p.login}, пароль ${p.password}`}>
                <Avatar name={p.display_name} size={38} />
                <span className="grow sbx-who">
                  <span className="sbx-name">
                    <span className="clip">{p.display_name}</span>
                    {/* Роль — уровень доступа; у наблюдателя она и есть должность. */}
                    {COMPANY_ROLE_LABELS[p.role].toLowerCase() !== p.position.toLowerCase() && <span className="sbx-role">{COMPANY_ROLE_LABELS[p.role].toLowerCase()}</span>}
                  </span>
                  <span className="sbx-pos">{p.position}</span>
                  <span className="sbx-blurb">{busy === p.login ? 'Входим…' : p.blurb}</span>
                </span>
                <span className="sbx-cred" aria-hidden>
                  <span>
                    <i>логин</i> <code>{p.login}</code>
                  </span>
                  <span>
                    <i>пароль</i> <code>{p.password}</code>
                  </span>
                </span>
                <ArrowRight size={16} className="sbx-go" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </Glass>
  );
}
