import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Check, Mail, MessageCircle, Pencil, Plus, UserRound, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { COMPANY_ROLE_LABELS, CONTACT_NAME_MAX, contactNameError, lastSeenText, plural } from '@offix/core';
import { ApiError } from '../../lib/api';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog, Empty, Skeleton } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { PageHero } from '../../ui/fx/PageHero';
import { chatApi, ck } from '../chats/data';
import { accountApi, ak, usePerson, usePersonGroups } from './data';
import './account.css';

const errText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не получилось, попробуйте ещё раз');

/** «Изменить контакт»: своё имя для коллеги — видно только мне. */
export function ContactNameDialog({ userId, realName, current, onClose }: { userId: string; realName: string; current: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (value: string) => {
    const err = contactNameError(value);
    if (err) return setError(err);
    setBusy(true);
    try {
      await accountApi.contactName(userId, value);
      await Promise.all([qc.invalidateQueries({ queryKey: ak.names }), qc.invalidateQueries({ queryKey: ak.person(userId) }), qc.invalidateQueries({ queryKey: ck.list })]);
      toast(value.trim() ? 'Имя сохранено — его видите только вы' : 'Вернули настоящее имя');
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Изменить контакт"
      onClose={onClose}
      footer={
        <>
          {current && (
            <Button variant="ghost" disabled={busy} onClick={() => void save('')}>
              Вернуть «{realName}»
            </Button>
          )}
          <Button variant="primary" loading={busy} onClick={() => void save(name)}>
            Сохранить
          </Button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        Как подписать коллегу у вас: в чатах, задачах и поиске. Сам человек и остальные этого имени не видят.
      </p>
      <Field label="Имя для себя" error={error} counter={{ value: name.length, max: CONTACT_NAME_MAX }}>
        {(p) => <input className="input" {...p} autoFocus value={name} placeholder={realName} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save(name)} />}
      </Field>
    </Dialog>
  );
}

/** Карточка коллеги — её открывает QR-код профиля и имя в чате. */
export function PersonPage() {
  const { id = '' } = useParams();
  const q = usePerson(id);
  const groups = usePersonGroups(id, !!q.data && !q.data.is_me);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [rename, setRename] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const p = q.data;

  if (q.isLoading) return <div className="page"><Skeleton h={300} /></div>;
  if (!p) {
    return (
      <div className="page">
        <div className="card">
          <Empty icon={<UserRound size={22} />} title="Сотрудник не найден" action={<Button onClick={() => navigate('/app/org')}>К команде</Button>}>
            Карточки открываются только для коллег из вашей компании.
          </Empty>
        </div>
      </div>
    );
  }
  const shown = p.my_name ?? p.display_name;
  const write = async () => {
    try {
      const chat = await chatApi.direct(p.id);
      void qc.invalidateQueries({ queryKey: ck.list });
      navigate(`/app/chats/${chat.id}`);
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  const addTo = async (chatId: string, title: string) => {
    setAdding(chatId);
    try {
      await chatApi.addMembers(chatId, [p.id]);
      await qc.invalidateQueries({ queryKey: ak.groups(p.id) });
      toast(`${shown.split(' ')[0]} — в группе «${title}»`);
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setAdding(null);
    }
  };
  const status = p.active ? lastSeenText(p.online, p.last_seen_at, new Date().toISOString()) : 'больше не работает в компании';

  return (
    <div className="page acc-page" style={{ maxWidth: 960 }}>
      <PageHero
        variant="profile"
        icon={UserRound}
        compact
        back={
          <Link to="/app/org">
            <ArrowLeft size={15} aria-hidden /> Команда
          </Link>
        }
        eyebrow={p.is_me ? 'Это вы' : status}
        title={shown}
        subtitle={[p.my_name ? `Настоящее имя — ${p.display_name}` : null, p.position, COMPANY_ROLE_LABELS[p.role]].filter(Boolean).join(' · ')}
        actions={
          p.is_me ? (
            <Button icon={<Pencil size={14} />} onClick={() => navigate('/app/profile')}>
              Мой профиль
            </Button>
          ) : (
            <>
              {p.active && (
                <Button variant="primary" icon={<MessageCircle size={15} />} onClick={() => void write()}>
                  Написать
                </Button>
              )}
              <Button icon={<Pencil size={14} />} onClick={() => setRename(true)}>
                Изменить контакт
              </Button>
            </>
          )
        }
      />
      <div className="acc-grid">
        <section className="card acc-card" aria-label="О сотруднике">
          <div className="acc-me">
            <Avatar name={p.display_name} size={72} id={p.id} />
            <div className="grow acc-me-text">
              <b>{shown}</b>
              <span className="faint">{p.position ?? 'Сотрудник'}</span>
              <span className={`acc-presence ${p.online ? 'is-online' : ''}`}>{status}</span>
            </div>
          </div>
          <dl className="acc-facts">
            <div>
              <dt>
                <Mail size={14} aria-hidden /> Почта
              </dt>
              <dd>
                <a href={`mailto:${p.email}`} className="clip">
                  {p.email}
                </a>
              </dd>
            </div>
            <div>
              <dt>
                <Building2 size={14} aria-hidden /> Подразделения
              </dt>
              <dd>{p.units.length ? p.units.map((u) => `${u.name}${u.is_manager ? ' (руководитель)' : ''}`).join(', ') : 'не указаны'}</dd>
            </div>
          </dl>
        </section>
        {!p.is_me && (
          <section className="card acc-card" aria-labelledby="person-groups">
            <h2 id="person-groups" className="acc-h">
              <Users size={18} aria-hidden /> Мои группы
            </h2>
            {groups.isLoading ? (
              <Skeleton h={120} />
            ) : groups.data?.length ? (
              <div className="list">
                {groups.data.map((g) => (
                  <div key={g.id} className="list-row acc-group">
                    <span className="grow">
                      <span className="clip" style={{ fontWeight: 600, display: 'block' }}>
                        {g.name}
                      </span>
                      <span className="faint" style={{ fontSize: 12.5 }}>
                        {g.members} {plural(g.members, ['участник', 'участника', 'участников'])}
                      </span>
                    </span>
                    {g.is_member ? (
                      <span className="acc-in">
                        <Check size={14} aria-hidden /> уже в группе
                      </span>
                    ) : g.can_add && p.active ? (
                      <Button size="sm" icon={<Plus size={14} />} loading={adding === g.id} onClick={() => void addTo(g.id, g.name)}>
                        Добавить
                      </Button>
                    ) : (
                      <span className="faint" style={{ fontSize: 12.5 }}>
                        добавляет админ
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="faint" style={{ margin: 0 }}>
                Вы пока не состоите в группах.
              </p>
            )}
          </section>
        )}
      </div>
      {rename && <ContactNameDialog userId={p.id} realName={p.display_name} current={p.my_name} onClose={() => setRename(false)} />}
    </div>
  );
}
