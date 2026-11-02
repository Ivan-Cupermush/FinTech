import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, GraduationCap, History, Link2, MessagesSquare, NotebookPen, Plug, ShieldCheck, SlidersHorizontal, Sparkles, Wallet, type LucideIcon } from 'lucide-react';
import {
  describeModulesChange,
  matchingPreset,
  MODULE_KEYS,
  MODULE_PRESETS,
  MODULES,
  moduleInfo,
  type CompanyModules,
  type CompanyModulesView,
  type ModuleKey,
  type ModulePresetKey,
  type ModulesHistoryEntry,
} from '@offix/core';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/queries';
import { Empty, Skeleton } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { Glass } from '../../ui/fx/Glass';
import { PageHero } from '../../ui/fx/PageHero';
import { gradientCss, gradientLook, type SectionVariant } from '../../ui/fx/gradients';
import { useDarkTheme } from '../../ui/fx/support';
import './company.css';

const KEY = ['company-modules'] as const;
const HISTORY = ['company-modules', 'history'] as const;

/** Знак и градиент раздела — те же, что у его собственной шапки. */
const LOOK: Record<ModuleKey, { icon: LucideIcon; variant: SectionVariant }> = {
  sales: { icon: Wallet, variant: 'sales' },
  chats: { icon: MessagesSquare, variant: 'chats' },
  knowledge_ai: { icon: Sparkles, variant: 'assistant' },
  my_notes: { icon: NotebookPen, variant: 'notes' },
  integrations: { icon: Plug, variant: 'integrations' },
};

const PRESET_ICON: Record<ModulePresetKey, LucideIcon> = { university: GraduationCap, company: Building2 };

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Не получилось сохранить, попробуйте ещё раз');

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Функции компании: владелец или администратор включает крупные разделы под
 * свою организацию. Выключенное пропадает из меню на сайте и в приложении у
 * всех сотрудников сразу; данные раздела остаются и вернутся вместе с ним.
 */
export function CompanyFunctionsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<CompanyModulesView>('/company/modules') });
  const can = !!q.data?.can_change;
  const history = useQuery({ queryKey: HISTORY, queryFn: () => api<ModulesHistoryEntry[]>('/company/modules/history'), enabled: can });

  const save = useMutation({
    mutationFn: (body: { modules: Partial<CompanyModules> } | { preset: ModulePresetKey }) => api<CompanyModulesView>('/company/modules', { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: HISTORY });
      void qc.invalidateQueries({ queryKey: ['functions'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const mods = q.data?.modules;
  const preset = mods ? matchingPreset(mods) : null;
  const on = mods ? MODULE_KEYS.filter((k) => mods[k]).length : 0;

  const toggle = (key: ModuleKey, value: boolean) =>
    save.mutate({ modules: { [key]: value } }, { onSuccess: () => toast(`«${moduleInfo(key).title}» — ${value ? 'включено' : 'выключено'} для всей компании`) });
  const apply = (key: ModulePresetKey) =>
    save.mutate({ preset: key }, { onSuccess: () => toast(`Набор «${MODULE_PRESETS.find((p) => p.key === key)!.title}» применён`) });

  return (
    <div className="page cf-page" style={{ maxWidth: 1040 }}>
      <PageHero
        variant="org"
        icon={SlidersHorizontal}
        eyebrow={me.data?.company_name}
        title="Функции компании"
        subtitle="Включите то, чем пользуется ваша организация. Выключенный раздел пропадает из меню на сайте и в приложении у всех сотрудников, а его данные сохраняются."
        stats={
          mods
            ? [
                { label: 'разделов включено', value: `${on} из ${MODULE_KEYS.length}` },
                { label: 'набор', value: preset ? MODULE_PRESETS.find((p) => p.key === preset)!.title : 'Свой' },
              ]
            : undefined
        }
      />

      {q.isLoading ? (
        <Skeleton h={320} />
      ) : q.isError || !mods ? (
        <div className="card">
          <Empty icon={<SlidersHorizontal size={22} />} title="Не удалось загрузить функции">
            {errText(q.error)}
          </Empty>
        </div>
      ) : (
        <>
          {!can && (
            <div className="cf-note" role="note">
              <ShieldCheck size={18} aria-hidden />
              <span>Это настройки всей компании. Менять их может владелец или администратор — здесь видно, что включено.</span>
            </div>
          )}

          <section aria-labelledby="cf-presets-h" className="cf-section">
            <h2 id="cf-presets-h" className="cf-h">
              Готовые наборы
            </h2>
            <div className="cf-presets">
              {MODULE_PRESETS.map((p) => {
                const Icon = PRESET_ICON[p.key];
                const active = preset === p.key;
                return (
                  <button key={p.key} type="button" className={`cf-preset ${active ? 'is-active' : ''}`} disabled={!can || save.isPending || active} aria-pressed={active} onClick={() => apply(p.key)}>
                    <span className="cf-preset-icon" aria-hidden>
                      <Icon size={20} />
                    </span>
                    <span className="grow stack" style={{ '--gap': '3px' } as React.CSSProperties}>
                      <b>{p.title}</b>
                      <span className="faint">{p.description}</span>
                    </span>
                    <span className="cf-preset-state">{active ? <><Check size={14} aria-hidden /> Сейчас</> : can ? 'Применить' : ''}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="cf-modules-h" className="cf-section">
            <h2 id="cf-modules-h" className="cf-h">
              Разделы
            </h2>
            <div className="cf-grid">
              {MODULES.map((m) => (
                <ModuleCard key={m.key} module={m.key} on={mods[m.key]} disabled={!can || save.isPending} onChange={(v) => toggle(m.key, v)} />
              ))}
            </div>
          </section>

          <div className="cf-core">
            <ShieldCheck size={18} aria-hidden />
            <span>
              <b>Ядро offix включено всегда:</b> цели и KPI, задачи, оргструктура, «Эффект», отчёт руководству и статьи базы знаний. На них держится всё остальное.
            </span>
          </div>

          {can && (
            <section aria-labelledby="cf-history-h" className="card card-tight cf-section">
              <h2 id="cf-history-h" className="cf-h cf-h-in">
                <History size={17} aria-hidden /> Журнал изменений
              </h2>
              {history.isLoading ? (
                <Skeleton h={60} />
              ) : history.data?.length ? (
                <ul className="cf-history">
                  {history.data.map((e) => (
                    <li key={e.id}>
                      <span className="grow">{describeModulesChange(e)}</span>
                      <span className="faint">
                        {e.actor_name ?? 'Система'} · {when(e.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="faint cf-history-empty">Пока ничего не меняли — включено то, что было с самого начала.</p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ModuleCard({ module, on, disabled, onChange }: { module: ModuleKey; on: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  const dark = useDarkTheme();
  const info = moduleInfo(module);
  const { icon: Icon, variant } = LOOK[module];
  const id = `cf-${module}`;
  return (
    <div className={`cf-tile ${on ? 'is-on' : 'is-off'}`} style={{ background: gradientCss(gradientLook(variant, dark)) }} data-module={module}>
      <Glass className="cf-glass" radius={24} elasticity={0} displacement={36} blur={0.3} clip>
        <div className="cf-card">
          <div className="cf-head">
            <span className="cf-icon" aria-hidden>
              <Icon size={20} />
            </span>
            <span className="grow stack" style={{ '--gap': '2px', minWidth: 0 } as React.CSSProperties}>
              <label htmlFor={id} className="cf-title">
                {info.title}
              </label>
              <span className="cf-state">{on ? 'Включено' : 'Выключено'}</span>
            </span>
            <input id={id} type="checkbox" role="switch" className="switch cf-switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={`${id}-d`} />
          </div>
          <p id={`${id}-d`} className="cf-desc">
            {info.description}
          </p>
          <div className="cf-impact">
            <span className="cf-impact-h">{on ? 'Если выключить, пропадёт' : 'Сейчас скрыто у всех'}</span>
            <ul>
              {info.impact.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
          <div className="cf-related">
            <Link2 size={13} aria-hidden /> {info.related}
          </div>
        </div>
      </Glass>
    </div>
  );
}
