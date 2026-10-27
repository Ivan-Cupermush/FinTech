import { useVideoPlayer, VideoView } from 'expo-video';
import { Download, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { moscowTime, type Attachment } from '@offix/core';
import { absUri, openAttachment, useFileUri } from '../lib/files';
import type { ViewerItem } from '../lib/media';
import { font } from '../lib/theme';
import { Avatar, Text } from './primitives';

function PhotoPage({ a, width, height }: { a: Attachment; width: number; height: number }) {
  const uri = useFileUri(a);
  const thumb = absUri(a.thumb_url);
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      {thumb && <Image source={{ uri: thumb }} style={[StyleSheet.absoluteFill, { opacity: 0.35 }]} blurRadius={24} />}
      {uri ? <Image source={{ uri }} style={{ width, height }} resizeMode="contain" accessibilityIgnoresInvertColors /> : <ActivityIndicator color="#fff" />}
    </View>
  );
}

/** Видео играет, только пока на экране: плеер живёт у текущей страницы. */
function VideoPage({ a, width, height, active }: { a: Attachment; width: number; height: number; active: boolean }) {
  const uri = useFileUri(a, active);
  const player = useVideoPlayer(active && uri ? { uri } : null, (p) => {
    p.loop = false;
    p.play();
  });
  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      {active && uri ? <VideoView player={player} style={{ width, height: height * 0.8 }} contentFit="contain" nativeControls /> : a.thumb_url ? <Image source={{ uri: absUri(a.thumb_url) }} style={{ width, height }} resizeMode="contain" /> : <ActivityIndicator color="#fff" />}
    </View>
  );
}

/**
 * Просмотр во весь экран: свайп между всеми фото и видео ленты, сверху —
 * кто и когда прислал, счётчик и «Сохранить», снизу — лента миниатюр.
 */
export function MediaViewer({ items, index, onClose }: { items: ViewerItem[]; index: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [at, setAt] = useState(index);
  const [saving, setSaving] = useState(false);
  const list = useRef<FlatList<ViewerItem>>(null);
  const cur = items[at];
  const go = (i: number) => {
    const n = Math.max(0, Math.min(items.length - 1, i));
    setAt(n);
    list.current?.scrollToIndex({ index: n, animated: true });
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // В веб-сборке листаем и стрелками.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(at + 1);
      else if (e.key === 'ArrowLeft') go(at - 1);
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  });

  if (!cur) return null;
  const video = cur.attachment.kind === 'video';
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <View accessibilityLabel={video ? 'Просмотр видео' : 'Просмотр фото'} style={{ flex: 1, backgroundColor: '#04050d' }}>
        <FlatList
          ref={list}
          data={items}
          horizontal
          pagingEnabled
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(it) => it.attachment.id}
          onMomentumScrollEnd={(e) => setAt(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item, index: i }) => (item.attachment.kind === 'video' ? <VideoPage a={item.attachment} width={width} height={height} active={i === at} /> : <PhotoPage a={item.attachment} width={width} height={height} />)}
        />

        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, paddingTop: insets.top + 8, paddingHorizontal: 12, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(4,5,13,0.55)' }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose} hitSlop={10} style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' }}>
            <X size={20} color="#fff" />
          </Pressable>
          <Avatar name={cur.sender_name ?? 'Удалённый аккаунт'} id={cur.sender_id} size={34} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: '#fff', fontFamily: font.semibold, fontSize: 15 }}>
              {cur.sender_name ?? 'Удалённый аккаунт'}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12.5 }}>{`${new Date(cur.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })}, ${moscowTime(cur.created_at)}${items.length > 1 ? ` · ${at + 1} из ${items.length}` : ''}`}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Сохранить"
            onPress={() => {
              setSaving(true);
              openAttachment(cur.attachment)
                .catch((e) => Alert.alert('Не сохранилось', e instanceof Error ? e.message : 'Попробуйте ещё раз'))
                .finally(() => setSaving(false));
            }}
            hitSlop={10}
            style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' }}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Download size={19} color="#fff" />}
          </Pressable>
        </View>

        {items.length > 1 && (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: insets.bottom + 10, paddingTop: 10, backgroundColor: 'rgba(4,5,13,0.55)' }}>
            <FlatList
              data={items}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(it) => it.attachment.id}
              contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}
              renderItem={({ item, index: i }) => (
                <Pressable accessibilityRole="button" accessibilityLabel={`Перейти к ${i + 1}`} onPress={() => go(i)} style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: i === at ? '#fff' : 'transparent', opacity: i === at ? 1 : 0.6, backgroundColor: '#1a1d3a' }}>
                  {item.attachment.thumb_url && <Image source={{ uri: absUri(item.attachment.thumb_url) }} style={StyleSheet.absoluteFill} />}
                </Pressable>
              )}
            />
          </View>
        )}
      </View>
    </Modal>
  );
}
