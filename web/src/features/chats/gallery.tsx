import { ExternalLink, Film, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { GALLERY_TABS, GALLERY_TAB_LABELS, formatBytes, groupByDay, formatClock, moscowTime, type ChatGalleryItem, type GalleryTab } from '@offix/core';
import { fileSrc } from '../../lib/files';
import { Skeleton } from '../../ui/Misc';
import { useChatStats, useGallery } from './data';
import { FileRow, VoicePlayer } from './media';
import { MediaViewer, type ViewerItem } from './viewer';

const dayOf = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });

/** Медиа, файлы, голосовые и ссылки чата — вкладками, как в Telegram; сверху — сводка. */
export function ChatGalleryView({ chatId, onJump }: { chatId: string; onJump: (messageId: string) => void }) {
  const [tab, setTab] = useState<GalleryTab>('media');
  const [view, setView] = useState<number | null>(null);
  const q = useGallery(chatId, tab);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const media: ViewerItem[] = useMemo(
    () => (tab === 'media' ? items.filter((i) => i.attachment).map((i) => ({ attachment: i.attachment!, message_id: i.message_id, sender_id: i.sender_id, sender_name: i.sender_name, created_at: i.created_at })) : []),
    [items, tab],
  );

  return (
    <section className="gallery" aria-label="Медиа и файлы">
      <ChatStatsCard chatId={chatId} />
      <div className="gallery-tabs" role="tablist" aria-label="Что показать">
        {GALLERY_TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>
            {GALLERY_TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div className={`gallery-body is-${tab}`} role="tabpanel" aria-label={GALLERY_TAB_LABELS[tab]}>
        {q.isLoading ? (
          <div className="gallery-loading">
            <Skeleton h={88} r={14} />
            <Skeleton h={88} r={14} />
            <Skeleton h={88} r={14} />
          </div>
        ) : !items.length ? (
          <p className="faint gallery-empty">{EMPTY[tab]}</p>
        ) : tab === 'media' ? (
          <div className="gallery-grid">
            {media.map((it, i) => (
              <button key={it.attachment.id} type="button" className="gallery-cell" onClick={() => setView(i)} aria-label={`${it.attachment.kind === 'video' ? 'Видео' : 'Фото'} от ${it.sender_name ?? 'удалённого аккаунта'}`}>
                {it.attachment.thumb_url ? <img src={fileSrc(it.attachment.thumb_url)} alt="" loading="lazy" /> : <Film size={22} />}
                {it.attachment.kind === 'video' && (
                  <span className="album-badge">
                    <Play size={10} fill="currentColor" /> {formatClock(it.attachment.duration)}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <Grouped items={items}>
            {(it) =>
              tab === 'links' && it.link ? (
                <a className="gallery-link" href={it.link.url} target="_blank" rel="noopener noreferrer" key={`${it.message_id}-${it.link.url}`}>
                  <span className="gallery-link-ico" aria-hidden>
                    {it.link.host.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="grow">
                    <b className="clip">{it.link.host}</b>
                    <span className="clip faint">{it.link.url}</span>
                  </span>
                  <ExternalLink size={15} aria-hidden />
                </a>
              ) : it.attachment && tab === 'files' ? (
                <div className="gallery-row" key={it.attachment.id}>
                  <FileRow a={it.attachment} />
                  <button type="button" className="gallery-when" onClick={() => onJump(it.message_id)}>
                    {it.sender_name?.split(' ')[0] ?? '—'} · {moscowTime(it.created_at)}
                  </button>
                </div>
              ) : it.attachment ? (
                <div className="gallery-row" key={it.attachment.id}>
                  <VoicePlayer a={it.attachment} listened mine />
                  <button type="button" className="gallery-when" onClick={() => onJump(it.message_id)}>
                    {it.sender_name?.split(' ')[0] ?? '—'} · {moscowTime(it.created_at)}
                  </button>
                </div>
              ) : null
            }
          </Grouped>
        )}
        {q.hasNextPage && (
          <button type="button" className="gallery-more" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}
          </button>
        )}
      </div>
      {view !== null && <MediaViewer items={media} index={view} onClose={() => setView(null)} onJump={onJump} />}
    </section>
  );
}

const EMPTY: Record<GalleryTab, string> = {
  media: 'Фото и видео из переписки появятся здесь',
  files: 'Документы и архивы из переписки появятся здесь',
  voice: 'Голосовые и видеосообщения появятся здесь',
  links: 'Ссылки из сообщений появятся здесь',
};

function Grouped({ items, children }: { items: ChatGalleryItem[]; children: (it: ChatGalleryItem) => React.ReactNode }) {
  const groups = groupByDay(items, new Date().toISOString());
  return (
    <>
      {groups.map((g) => (
        <div key={g.day} className="gallery-group">
          <div className="gallery-day">{g.label}</div>
          {g.items.map(children)}
        </div>
      ))}
    </>
  );
}

function ChatStatsCard({ chatId }: { chatId: string }) {
  const s = useChatStats(chatId).data;
  if (!s) return <Skeleton h={112} r={20} />;
  const tiles = [
    { n: s.messages, label: 'сообщений' },
    { n: s.photos + s.videos, label: 'фото и видео' },
    { n: s.files, label: 'файлов' },
    { n: s.voice + s.video_notes, label: 'голосовых' },
  ];
  const top = s.top_senders.slice(0, 3);
  const max = Math.max(1, ...top.map((t) => t.messages));
  return (
    <div className="chat-stats" aria-label="Статистика чата">
      <div className="chat-stats-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="chat-stats-tile">
            <b>{t.n.toLocaleString('ru-RU')}</b>
            <span>{t.label}</span>
          </div>
        ))}
      </div>
      {top.length > 0 && (
        <div className="chat-stats-top">
          {top.map((t) => (
            <div key={t.id} className="chat-stats-row">
              <span className="clip">{t.display_name}</span>
              <span className="chat-stats-bar" style={{ '--p': t.messages / max } as React.CSSProperties} aria-hidden />
              <b>{t.messages}</b>
            </div>
          ))}
        </div>
      )}
      <p className="faint chat-stats-foot">
        {s.bytes ? `Файлы занимают ${formatBytes(s.bytes)}` : 'Файлов пока нет'}
        {s.first_message_at ? ` · переписка с ${dayOf(s.first_message_at)}` : ''}
      </p>
    </div>
  );
}
