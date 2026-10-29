import { MessagesSquare, SquarePen } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '../../ui/Button';
import { Backdrop } from '../../ui/fx/Backdrop';
import { useMediaQuery } from '../../ui/fx/support';
import { ChatList } from './ChatList';
import { ChatScreen } from './ChatView';
import { CreateChatDialog } from './dialogs';
import './chats.css';

/**
 * Мессенджер: слева список, справа переписка. На телефоне — по очереди:
 * список с живой шапкой, а открытый чат занимает весь экран.
 */
export function ChatsPage() {
  const { id } = useParams();
  const narrow = useMediaQuery('(max-width: 900px)');
  const [creating, setCreating] = useState(false);
  return (
    <div className={`chats ${id ? 'has-chat' : ''}`}>
      {(!narrow || !id) && <ChatList activeId={id ?? null} onCreate={() => setCreating(true)} />}
      {(!narrow || id) && <section className="chat-pane">{id ? <ChatScreen key={id} chatId={id} /> : <ChatsWelcome onCreate={() => setCreating(true)} />}</section>}
      {creating && <CreateChatDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Пока чат не выбран — живая сцена раздела со стеклянным облачком. */
function ChatsWelcome({ onCreate }: { onCreate: () => void }) {
  return (
    <Backdrop variant="chats" framed glyph="chats" glyphIcon={MessagesSquare} className="chats-welcome on-color" role="region" aria-label="Чат не выбран">
      <div className="chats-welcome-text">
        <div className="eyebrow">Мессенджер offix</div>
        <h2>Пишите коллегам там же, где работаете</h2>
        <p>Личные чаты, рабочие группы и темы, опросы, закреп и отложенные сообщения. Выберите чат слева или начните новый.</p>
        <Button variant="primary" icon={<SquarePen size={16} />} onClick={onCreate}>
          Новый чат
        </Button>
      </div>
    </Backdrop>
  );
}
