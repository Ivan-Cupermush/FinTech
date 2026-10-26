import { router, useLocalSearchParams } from 'expo-router';
import { ExternalLink, Film, Play } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { formatBytes, formatClock, GALLERY_TAB_LABELS, GALLERY_TABS, groupByDay, plural, moscowTime, type ChatGalleryItem, type GalleryTab } from '@offix/core';
import { useChatStats, useGallery } from '../../../lib/chats';
import { absUri } from '../../../lib/files';
import { gridCell, type ViewerItem } from '../../../lib/media';
import { font, usePalette } from '../../../lib/theme';
import { LiquidSegmented } from '../../../ui/fx/LiquidSegmented';
import { FileRow, VoiceBubble } from '../../../ui/media';
import { Button, Card, Empty, Screen, Text } from '../../../ui/primitives';
import { MediaViewer } from '../../../ui/viewer';

const EMPTY: Record<GalleryTab, string> = {
  media: 'Фото и видео из переписки появятся здесь',
  files: 'Документы и архивы из переписки появятся здесь',
  voice: 'Голосовые и видеосообщения появятся здесь',
  links: 'Ссылки из сообщений появятся здесь',
};

/** Медиа, файлы, голосовые и ссылки чата — вкладками, как на сайте; сверху — сводка. */
export default function ChatMediaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePalette();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<GalleryTab>('media');
  const [view, setView] = useState<number | null>(null);
  const q = useGallery(id, tab);
  const items = useMemo(() => q.data?.pages.flatMap((x) => x.items) ?? [], [q.data]);
  const media: ViewerItem[] = useMemo(
    () => (tab === 'media' ? items.filter((i) => i.attachment).map((i) => ({ attachment: i.attachment!, message_id: i.message_id, sender_id: i.sender_id, sender_name: i.sender_name, created_at: i.created_at })) : []),
    [items, tab],
  );
  const cell = gridCell(Math.min(width, 720) - 32, 3, 3);
  const now = new Date().toISOString();
  const openChat = () => router.back();

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <StatsCard chatId={id} />
      <LiquidSegmented label="Что показать" value={tab} onChange={setTab} options={GALLERY_TABS.map((t) => ({ value: t, label: GALLERY_TAB_LABELS[t] }))} />
      {q.isLoading ? (
        <ActivityIndicator color={p.ink3} style={{ marginTop: 24 }} />
      ) : !items.length ? (
        <Card>
          <Empty title="Пока пусто" text={EMPTY[tab]} />
        </Card>
      ) : tab === 'media' ? (
        <View accessibilityLabel="Медиа" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, borderRadius: 18, overflow: 'hidden' }}>
          {media.map((it, i) => (
            <Pressable key={it.attachment.id} accessibilityRole="imagebutton" accessibilityLabel={`${it.attachment.kind === 'video' ? 'Видео' : 'Фото'} от ${it.sender_name ?? 'удалённого аккаунта'}`} onPress={() => setView(i)} style={({ pressed }) => ({ width: cell, height: cell, backgroundColor: p.surface3, opacity: pressed ? 0.8 : 1, alignItems: 'center', justifyContent: 'center' })}>
              {it.attachment.thumb_url ? <Image source={{ uri: absUri(it.attachment.thumb_url) }} style={StyleSheet.absoluteFill} /> : <Film size={22} color={p.ink3} />}
              {it.attachment.kind === 'video' && (
                <View style={{ position: 'absolute', left: 5, bottom: 5, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, backgroundColor: 'rgba(8,10,30,0.55)' }}>
                  <Play size={9} color="#fff" fill="#fff" />
                  <Text style={{ color: '#fff', fontSize: 11, fontFamily: font.semibold }}>{formatClock(it.attachment.duration)}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      ) : (
        groupByDay(items, now).map((g) => (
          <View key={g.day} style={{ gap: 8 }}>
            <Text variant="eyebrow" tone="faint">
              {g.label}
            </Text>
            <Card style={{ gap: 4, paddingVertical: 8 }}>
              {g.items.map((it) => (
                <Row key={`${it.message_id}-${it.attachment?.id ?? it.link?.url}`} it={it} tab={tab} onOpenChat={openChat} />
              ))}
            </Card>
          </View>
        ))
      )}
      {q.hasNextPage && <Button title={q.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'} variant="secondary" onPress={() => void q.fetchNextPage()} loading={q.isFetchingNextPage} />}
      {view !== null && <MediaViewer items={media} index={view} onClose={() => setView(null)} />}
    </Screen>
  );
}

function Row({ it, tab, onOpenChat }: { it: ChatGalleryItem; tab: GalleryTab; onOpenChat: () => void }) {
  const p = usePalette();
  const who = (
    <Pressable accessibilityRole="button" accessibilityLabel="К сообщению" onPress={onOpenChat} hitSlop={6}>
      <Text variant="caption" tone="faint">
        {`${it.sender_name?.split(' ')[0] ?? '—'} · ${moscowTime(it.created_at)}`}
      </Text>
    </Pressable>
  );
  if (tab === 'links' && it.link) {
    const link = it.link;
    return (
      <Pressable accessibilityRole="link" accessibilityLabel={link.url} onPress={() => void Linking.openURL(link.url)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
        <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accentSoft }}>
          <Text style={{ color: p.accent, fontFamily: font.bold, fontSize: 16 }}>{link.host.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: font.semibold }}>
            {link.host}
          </Text>
          <Text numberOfLines={1} variant="caption" tone="faint">
            {link.url}
          </Text>
        </View>
        <ExternalLink size={16} color={p.ink3} />
      </Pressable>
    );
  }
  if (!it.attachment) return null;
  return (
    <View style={{ gap: 2, paddingVertical: 4 }}>
      {tab === 'files' ? <FileRow a={it.attachment} ink={p.ink} soft={p.ink3} onTile /> : <VoiceBubble a={it.attachment} mine={false} listened ink={p.ink} soft={p.ink3} />}
      {who}
    </View>
  );
}

/** Сводка: сколько всего, кто пишет больше всех и сколько места занимают файлы. */
function StatsCard({ chatId }: { chatId: string }) {
  const p = usePalette();
  const s = useChatStats(chatId).data;
  if (!s) return <Card style={{ height: 120 }}>{null}</Card>;
  const tiles = [
    { n: s.messages, label: plural(s.messages, ['сообщение', 'сообщения', 'сообщений']) },
    { n: s.photos + s.videos, label: 'фото и видео' },
    { n: s.files, label: plural(s.files, ['файл', 'файла', 'файлов']) },
    { n: s.voice + s.video_notes, label: plural(s.voice + s.video_notes, ['голосовое', 'голосовых', 'голосовых']) },
  ];
  const top = s.top_senders.slice(0, 3);
  const max = Math.max(1, ...top.map((t) => t.messages));
  return (
    <Card style={{ gap: 12 }}>
      <View accessibilityLabel="Статистика чата" style={{ flexDirection: 'row', gap: 6 }}>
        {tiles.map((t) => (
          <View key={t.label} style={{ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 10, borderRadius: 16, backgroundColor: p.surface2 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 19, fontVariant: ['tabular-nums'] }}>{t.n.toLocaleString('ru-RU')}</Text>
            <Text variant="caption" tone="faint" style={{ textAlign: 'center' }}>
              {t.label}
            </Text>
          </View>
        ))}
      </View>
      {top.map((t) => (
        <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text numberOfLines={1} variant="small" style={{ width: 110 }}>
            {t.display_name}
          </Text>
          <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: p.surface3, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round((t.messages / max) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: p.accent }} />
          </View>
          <Text variant="small" style={{ fontFamily: font.semibold, width: 34, textAlign: 'right' }}>
            {t.messages}
          </Text>
        </View>
      ))}
      <Text variant="caption" tone="faint">
        {s.bytes ? `Файлы занимают ${formatBytes(s.bytes)}` : 'Файлов пока нет'}
        {s.first_message_at ? ` · переписка с ${new Date(s.first_message_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })}` : ''}
      </Text>
    </Card>
  );
}
