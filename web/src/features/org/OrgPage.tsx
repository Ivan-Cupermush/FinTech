import { Building2, Copy, Network, Plus, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { buildTree, plural, COMPANY_ROLE_HINTS, COMPANY_ROLE_LABELS, COMPANY_ROLES, UNIT_TYPE_LABELS, UNIT_TYPES, type CompanyRole, type FieldErrors, type TreeNode, type UnitType } from '@offix/core';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { orgHeroStats } from '../../lib/hero-stats';
import { useMe, useUnits, useUsers } from '../../lib/queries';
import { PageHero } from '../../ui/fx/PageHero';
import type { OrgUnitRow } from '../../lib/types';
import { Avatar, AvatarStack } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog, Empty, Skeleton, Tabs } from '../../ui/Misc';
import { Pill } from '../../ui/Pill';
import { useToast } from '../../ui/Toast';

type Tab = 'structure' | 'people';

/**
 * Одна модель для двух режимов: в «быстром старте» структура пустая и
 * всё работает без неё; подразделения добавляются, когда компания растёт.
 */
export function OrgPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>('structure');
  const [dialog, setDialog] = useState<'unit' | 'invite' | null>(null);
  const admin = me.data?.role === 'owner' || me.data?.role === 'admin';
  const people = useUsers();
  const units = useUnits();
  return (
    <div className="page">
      <PageHero
        variant="org"
        icon={Network}
        title="Организация"
        subtitle={me.data?.company_name ?? ' '}
        stats={people.data && units.data ? orgHeroStats(people.data, units.data) : undefined}
        actions={
          admin && (
            <>
              <Button icon={<UserPlus size={16} />} onClick={() => setDialog('invite')}>
                Пригласить
              </Button>
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => setDialog('unit')}>
                Подразделение
              </Button>
            </>
          )
        }
      />
      <div style={{ marginBottom: 20 }}>
        <Tabs
          label="Раздел организации"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'structure', label: 'Структура' },
            { value: 'people', label: 'Сотрудники' },
          ]}
        />
      </div>
      {tab === 'structure' ? <Structure admin={admin} onAdd={() => setDialog('unit')} /> : <People admin={admin} myRole={me.data?.role} />}
      {dialog === 'unit' && <UnitDialog onClose={() => setDialog(null)} />}
      {dialog === 'invite' && <InviteDialog onClose={() => setDialog(null)} canOwner={me.data?.role === 'owner'} />}
    </div>
  );
}

function Structure({ admin, onAdd }: { admin: boolean; onAdd: () => void }) {
  const units = useUnits();
  if (units.isLoading) return <Skeleton h={200} />;
  const active = (units.data ?? []).filter((u) => u.status === 'active');
  if (!active.length)
    return (
      <div className="card">
        <Empty icon={<Building2 size={22} />} title="Структура не задана" action={admin ? <Button variant="primary" onClick={onAdd}>Добавить подразделение</Button> : undefined}>
          Это нормально для небольшой команды: цели и задачи работают и без неё. Добавьте подразделения, когда понадобится разграничить доступ и видеть цели по отделам.
        </Empty>
      </div>
    );
  const tree = buildTree(active);
  return (
    <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
      {tree.map((n) => (
        <UnitNode key={n.item.id} node={n} depth={0} />
      ))}
    </div>
  );
}

function UnitNode({ node, depth }: { node: TreeNode<OrgUnitRow>; depth: number }) {
  const u = node.item;
  return (
    <div style={{ marginLeft: depth ? 28 : 0 }} className="stack">
      <div className="card card-tight spread" style={{ borderLeft: depth ? '3px solid var(--line-strong)' : undefined }}>
        <div className="stack" style={{ '--gap': '4px', minWidth: 0 } as React.CSSProperties}>
          <div className="row" style={{ gap: 8 }}>
            <b className="clip">{u.name}</b>
            <Pill plain>{UNIT_TYPE_LABELS[u.unit_type]}</Pill>
          </div>
          <span className="faint" style={{ fontSize: 13 }}>
            {u.managers.length ? `Руководитель: ${u.managers.map((m) => m.display_name).join(', ')}` : 'Руководитель не назначен'}
          </span>
        </div>
        <div className="row" style={{ gap: 16, fontSize: 13 }}>
          {u.managers.length > 0 && <AvatarStack names={u.managers.map((m) => m.display_name)} />}
          <span className="row faint" style={{ gap: 4 }} title="Сотрудников">
            <Users size={14} /> {u.member_count}
          </span>
          <span className="faint" title="Активных целей">
            {u.active_goals} {plural(u.active_goals, ['цель', 'цели', 'целей'])}
          </span>
        </div>
      </div>
      {node.children.map((c) => (
        <UnitNode key={c.item.id} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

function People({ admin, myRole }: { admin: boolean; myRole?: CompanyRole }) {
  const [search, setSearch] = useState('');
  const users = useUsers(search);
  const qc = useQueryClient();
  const toast = useToast();
  const changeRole = async (id: string, role: CompanyRole) => {
    try {
      await api(`/users/${id}`, { method: 'PATCH', body: { role } });
      await qc.invalidateQueries({ queryKey: ['users'] });
      toast(`Роль изменена: ${COMPANY_ROLE_LABELS[role]}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <section className="card stack">
      <input className="input" aria-label="Поиск сотрудников" placeholder="Поиск по имени или почте" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
      {users.isLoading ? (
        <Skeleton h={160} />
      ) : (
        <div className="list">
          {(users.data ?? []).map((m) => (
            <div key={m.id} className="list-row" style={{ cursor: 'default', opacity: m.active ? 1 : 0.55 }}>
              <Avatar name={m.display_name} size={32} />
              <span className="grow stack" style={{ '--gap': '2px' } as React.CSSProperties}>
                <span style={{ fontWeight: 560 }}>
                  {m.display_name} {!m.active && <span className="faint">· отключён</span>}
                </span>
                <span className="faint clip" style={{ fontSize: 12.5 }}>
                  {[m.position, m.units.map((u) => `${u.name}${u.is_manager ? ' (рук.)' : ''}`).join(', '), m.email].filter(Boolean).join(' · ')}
                </span>
              </span>
              {admin && m.role !== 'owner' ? (
                <select className="select" aria-label={`Роль: ${m.display_name}`} value={m.role} onChange={(e) => changeRole(m.id, e.target.value as CompanyRole)} style={{ width: 'auto' }}>
                  {COMPANY_ROLES.filter((r) => r !== 'owner' || myRole === 'owner').map((r) => (
                    <option key={r} value={r} title={COMPANY_ROLE_HINTS[r]}>
                      {COMPANY_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <Pill plain>{COMPANY_ROLE_LABELS[m.role]}</Pill>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function UnitDialog({ onClose }: { onClose: () => void }) {
  const units = useUnits();
  const [name, setName] = useState('');
  const [type, setType] = useState<UnitType>('department');
  const [parent, setParent] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const save = async () => {
    if (!name.trim()) return setErrors({ name: 'Введите название' });
    setSaving(true);
    try {
      await api('/org/units', { body: { name: name.trim(), unit_type: type, parent_unit_id: parent || null } });
      await qc.invalidateQueries({ queryKey: ['units'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast('Подразделение добавлено');
      onClose();
    } catch (e) {
      setErrors(e instanceof ApiError ? { ...e.fields, _: e.message } : { _: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      title="Новое подразделение"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Добавить
          </Button>
        </>
      }
    >
      <Field label="Название" required error={errors.name}>
        {(p) => <input className="input" {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Учебный офис" />}
      </Field>
      <Field label="Тип">
        {(p) => (
          <select className="select" {...p} value={type} onChange={(e) => setType(e.target.value as UnitType)}>
            {UNIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {UNIT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Входит в" error={errors.parent_unit_id} hint="Команда может входить только в команду, отдел или дивизион">
        {(p) => (
          <select className="select" {...p} value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Верхний уровень</option>
            {(units.data ?? [])
              .filter((u) => u.status === 'active')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {UNIT_TYPE_LABELS[u.unit_type]}
                </option>
              ))}
          </select>
        )}
      </Field>
      {errors._ && <p className="field-error">{errors._}</p>}
    </Dialog>
  );
}

function InviteDialog({ onClose, canOwner }: { onClose: () => void; canOwner: boolean }) {
  const units = useUnits();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<CompanyRole>('member');
  const [unit, setUnit] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ email: string; temp_password: string } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const save = async () => {
    setSaving(true);
    try {
      const r = await api<{ temp_password: string }>('/users', { body: { email: email.trim(), display_name: name.trim(), role, unit_ids: unit ? [unit] : [] } });
      await qc.invalidateQueries({ queryKey: ['users'] });
      setDone({ email: email.trim(), temp_password: r.temp_password });
    } catch (e) {
      setErrors(e instanceof ApiError ? { ...e.fields, _: e.message } : { _: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };
  if (done)
    return (
      <Dialog title="Сотрудник приглашён" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Готово</Button>}>
        <p className="muted">Передайте данные для входа лично. Временный пароль показывается один раз — после входа его стоит сменить.</p>
        <div className="card card-tight stack" style={{ '--gap': '6px', background: 'var(--surface-2)' } as React.CSSProperties}>
          <span>
            Почта: <b>{done.email}</b>
          </span>
          <span className="row" style={{ gap: 8 }}>
            Пароль: <b className="num">{done.temp_password}</b>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy size={14} />}
              aria-label="Скопировать пароль"
              onClick={() => {
                void navigator.clipboard?.writeText(done.temp_password);
                toast('Пароль скопирован');
              }}
            />
          </span>
        </div>
      </Dialog>
    );
  return (
    <Dialog
      title="Пригласить сотрудника"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Пригласить
          </Button>
        </>
      }
    >
      <Field label="Имя и фамилия" required error={errors.display_name}>
        {(p) => <input className="input" {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="Рабочая почта" required error={errors.email}>
        {(p) => <input className="input" type="email" {...p} value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Field label="Роль" hint={COMPANY_ROLE_HINTS[role]} error={errors.role}>
        {(p) => (
          <select className="select" {...p} value={role} onChange={(e) => setRole(e.target.value as CompanyRole)}>
            {COMPANY_ROLES.filter((r) => r !== 'owner' || canOwner).map((r) => (
              <option key={r} value={r}>
                {COMPANY_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        )}
      </Field>
      {(units.data ?? []).length > 0 && (
        <Field label="Подразделение" error={errors.unit_ids}>
          {(p) => (
            <select className="select" {...p} value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">Без подразделения</option>
              {(units.data ?? [])
                .filter((u) => u.status === 'active')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          )}
        </Field>
      )}
      {errors._ && <p className="field-error">{errors._}</p>}
    </Dialog>
  );
}
