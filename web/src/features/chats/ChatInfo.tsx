import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Hash, IdCard, LogOut, MoreHorizontal, Pencil, Pin, PinOff, ShieldCheck, ShieldOff, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MUTE_PRESETS, isMuted, lastSeenText, muteUntil, nameFor, validateChatName, type ChatDetail, type ChatMember } from '@offix/core';
import { useContactBook } from '../account/data';
import { ApiError } from '../../lib/api';
import { useMe } from '../../lib/queries';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { chatApi, ck } from './data';
import { AddMembersDialog, AdminDialog, ConfirmDialog } from './dialogs';
import { ChatGalleryView } from './gallery';
import { ChatAvatar, Menu } from './parts';
import { useRealtime } from './realtime';

const ROLE: Record<ChatMember['role'], string> = { creator: 'создатель', admin: 'администратор', member: '' };

/** Карточка чата: участники и их права, мои настройки, темы, выход и удаление. */
export function ChatInfo({ chat, onClose, onJump }: { chat: ChatDetail; onClose: () => void; onJump: (messageId: string) => void }) {
  const me = useMe();
  const rt = useRealtime();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const book = useContactBook();
  const now = new Date().toISOString();
  const [dialog, setDialog] = useState<null | 'add' | 'leave' | 'delete' | 'topics' | { admin: ChatMember } | { remove: ChatMember }>(null);
  const [muteMenu, setMuteMenu] = useState<DOMRect | null>(null);
  const [memberMenu, setMemberMenu] = useState<{ m: ChatMember; at: DOMRect } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(chat.title);
  const group = chat.type === 'group';
  const can = (p: string) => chat.my_rights.includes(p as never);
  const myId = me.data?.id;
  const iAmCreator = chat.created_by === myId && group;
  const muted = isMuted(chat.muted_until, now);
  const online = (m: ChatMember) => rt.online.has(m.id) || (m.online && !rt.lastSeen.has(m.id));
  const onlineCount = chat.members.filter(online).length;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ck.detail(chat.id) });
    void qc.invalidateQueries({ queryKey: ck.list });
  };
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      refresh();
      if (ok) toast(ok);
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не получилось', 'error');
    }
  };

  const subtitle = group
    ? `${chat.members_count} участников${onlineCount ? `, ${onlineCount} в сети` : ''}`
    : chat.peer
      ? lastSeenText(rt.online.has(chat.peer.id) || (chat.peer.online && !rt.lastSeen.has(chat.peer.id)), rt.lastSeen.get(chat.peer.id) ?? chat.peer.last_seen_at, now)
      : 'Заметки для себя';

  return (
    <Panel title="Информация" subtitle={group ? (chat.is_supergroup ? 'Группа с темами' : 'Группа') : 'Личный чат'} onClose={onClose}>
      <div className="chat-info">
        <div className="info-hero">
          <ChatAvatar title={chat.title} group={group} size={88} userId={chat.peer?.id} />
          {renaming ? (
            <form
              className="info-rename"
              onSubmit={(e) => {
                e.preventDefault();
                if (validateChatName(name)) return;
                void act(() => chatApi.rename(chat.id, name.trim()), 'Название изменено').then(() => setRenaming(false));
              }}
            >
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Название группы" autoFocus />
              <Button type="submit" variant="primary" size="sm" disabled={!!validateChatName(name)}>
                Сохранить
              </Button>
            </form>
          ) : (
            <h3 className="info-title">
              {chat.title}
              {group && can('change_info') && <Button variant="ghost" size="sm" icon={<Pencil size={14} />} aria-label="Переименовать" onClick={() => setRenaming(true)} />}
            </h3>
          )}
          <div className="faint">{subtitle}</div>
          {!group && chat.peer?.contact_name && <div className="faint">Настоящее имя: {chat.peer.display_name}</div>}
          {!group && chat.peer?.position && <div className="faint">{chat.peer.position}</div>}
        </div>

        <div className="info-actions">
          <button type="button" onClick={(e) => (muted ? void act(() => chatApi.membership(chat.id, { muted_until: null }), 'Звук включён') : setMuteMenu(e.currentTarget.getBoundingClientRect()))}>
            {muted ? <Bell size={18} /> : <BellOff size={18} />}
            {muted ? 'Включить звук' : 'Без звука'}
          </button>
          <button type="button" onClick={() => act(() => chatApi.membership(chat.id, { pinned: !chat.pinned }), chat.pinned ? 'Чат откреплён' : 'Чат закреплён')}>
            {chat.pinned ? <PinOff size={18} /> : <Pin size={18} />}
            {chat.pinned ? 'Открепить' : 'Закрепить'}
          </button>
          {!group && chat.peer && (
            <button type="button" onClick={() => navigate(`/app/people/${chat.peer!.id}`)}>
              <IdCard size={18} />
              Профиль
            </button>
          )}
          {group && can('add_users') && (
            <button type="button" onClick={() => setDialog('add')}>
              <UserPlus size={18} />
              Добавить
            </button>
          )}
        </div>
        {muted && chat.muted_until && <p className="faint info-note">Без звука {chat.muted_until.startsWith('2100') ? 'навсегда' : `до ${new Date(chat.muted_until).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`}</p>}

        {group && chat.can_manage_topics && !chat.is_supergroup && (
          <div className="info-card">
            <div>
              <b>Темы</b>
              <p className="faint">Разделите переписку на ветки: объявления, вопросы, проекты. Вся история окажется в теме «Общее».</p>
            </div>
            <Button variant="secondary" size="sm" icon={<Hash size={14} />} onClick={() => setDialog('topics')}>
              Включить темы
            </Button>
          </div>
        )}

        {group && (
          <section className="info-members" aria-label="Участники">
            <div className="info-section-title">
              Участники <span className="faint">· {chat.members_count}</span>
            </div>
            {chat.members.map((m) => {
              const manage = m.id !== myId && m.role !== 'creator' && (can('ban_users') || can('add_admins'));
              return (
                <div key={m.id} className="info-member">
                  <span className="info-member-ava">
                    <Avatar name={m.display_name} size={40} id={m.id} />
                    {online(m) && <span className="chat-ava-online" />}
                  </span>
                  <span className="grow">
                    <span className="clip people-name">
                      {nameFor(book, m.id, m.display_name)}
                      {m.id === myId ? ' (вы)' : ''}
                    </span>
                    <span className="clip faint">{online(m) ? 'в сети' : lastSeenText(false, rt.lastSeen.get(m.id) ?? m.last_seen_at, now)}</span>
                  </span>
                  {ROLE[m.role] && <span className={`role-badge is-${m.role}`}>{ROLE[m.role]}</span>}
                  {manage && <Button variant="ghost" size="sm" icon={<MoreHorizontal size={16} />} aria-label={`Действия: ${m.display_name}`} onClick={(e) => setMemberMenu({ m, at: e.currentTarget.getBoundingClientRect() })} />}
                </div>
              );
            })}
          </section>
        )}

        <ChatGalleryView chatId={chat.id} onJump={onJump} />

        <div className="info-danger">
          {!group && (
            <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => setDialog('delete')}>
              Удалить чат
            </Button>
          )}
          {group && (
            <Button variant="ghost" icon={<LogOut size={16} />} onClick={() => setDialog('leave')}>
              Выйти из группы
            </Button>
          )}
          {iAmCreator && (
            <Button variant="ghost" className="is-danger" icon={<Trash2 size={16} />} onClick={() => setDialog('delete')}>
              Удалить группу
            </Button>
          )}
        </div>
      </div>

      {muteMenu && (
        <Menu
          anchor={muteMenu}
          align="start"
          label="Без звука"
          onClose={() => setMuteMenu(null)}
          items={MUTE_PRESETS.map((p) => ({ label: p.label, onSelect: () => act(() => chatApi.membership(chat.id, { muted_until: muteUntil(p.hours, new Date().toISOString()) }), 'Без звука') }))}
        />
      )}
      {memberMenu && (
        <Menu
          anchor={memberMenu.at}
          label={`Действия: ${memberMenu.m.display_name}`}
          onClose={() => setMemberMenu(null)}
          items={[
            can('add_admins') && { label: memberMenu.m.role === 'admin' ? 'Права администратора' : 'Назначить администратором', icon: <ShieldCheck size={16} />, onSelect: () => setDialog({ admin: memberMenu.m }) },
            can('add_admins') && memberMenu.m.role === 'admin' && { label: 'Снять администратора', icon: <ShieldOff size={16} />, onSelect: () => act(() => chatApi.dropAdmin(chat.id, memberMenu.m.id), 'Больше не администратор') },
            can('ban_users') && { label: 'Исключить из группы', icon: <UserMinus size={16} />, danger: true, onSelect: () => setDialog({ remove: memberMenu.m }) },
          ]}
        />
      )}
      {dialog === 'add' && <AddMembersDialog chatId={chat.id} members={chat.members.map((m) => m.id)} onClose={() => setDialog(null)} />}
      {dialog === 'topics' && (
        <ConfirmDialog title="Включить темы?" action="Включить" onClose={() => setDialog(null)} onConfirm={() => act(() => chatApi.enableTopics(chat.id), 'Темы включены')}>
          Группа станет группой с темами. Вся переписка окажется в теме «Общее», а новые темы смогут создавать создатель и администраторы.
        </ConfirmDialog>
      )}
      {dialog === 'leave' && (
        <ConfirmDialog
          title="Выйти из группы?"
          action="Выйти"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await chatApi.leave(chat.id);
            refresh();
            navigate('/app/chats');
          }}
        >
          {iAmCreator ? 'Вы создатель: группа перейдёт администратору или самому давнему участнику.' : 'Вернуться можно будет, только если вас снова пригласят.'}
        </ConfirmDialog>
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={group ? 'Удалить группу?' : 'Удалить чат?'}
          action="Удалить"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await chatApi.remove(chat.id);
            refresh();
            navigate('/app/chats');
          }}
        >
          {group ? 'Группа и вся переписка исчезнут у всех участников. Это не отменить.' : 'Переписка исчезнет у вас обоих. Это не отменить.'}
        </ConfirmDialog>
      )}
      {dialog && typeof dialog === 'object' && 'admin' in dialog && <AdminDialog chatId={chat.id} member={dialog.admin} mine={chat.my_rights} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && 'remove' in dialog && (
        <ConfirmDialog title="Исключить из группы?" action="Исключить" danger onClose={() => setDialog(null)} onConfirm={() => act(() => chatApi.removeMember(chat.id, dialog.remove.id), 'Участник исключён')}>
          {dialog.remove.display_name} больше не увидит переписку группы.
        </ConfirmDialog>
      )}
    </Panel>
  );
}
