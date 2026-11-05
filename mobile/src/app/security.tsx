import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { CircleAlert, Download, FileLock2, KeyRound, QrCode, ShieldCheck, UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { todayIso, type LoginMethod } from '@offix/core';
import { ApiError } from '../lib/client';
import { loginRow, loginsNote } from '../lib/personal';
import { accountApi, mk, shareMyData } from '../lib/personal-api';
import { font, usePalette } from '../lib/theme';
import { PageHero } from '../ui/fx/PageHero';
import { Button, Card, Screen, Text } from '../ui/primitives';

const METHOD_ICON: Record<LoginMethod, typeof KeyRound> = { password: KeyRound, qr: QrCode, register: UserPlus };

/** «Безопасность и мои данные»: кто входил в учётную запись, файл со всеми моими данными, политика. */
export default function SecurityScreen() {
  const p = usePalette();
  const q = useQuery({ queryKey: mk.logins, queryFn: accountApi.logins });
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const logins = q.data ?? [];
  const shown = all ? logins : logins.slice(0, 6);

  const download = async () => {
    setBusy(true);
    try {
      await shareMyData(todayIso());
    } catch (e) {
      Alert.alert('Не получилось', e instanceof ApiError ? e.message : 'Не удалось скачать данные');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <PageHero variant="security" icon={ShieldCheck} eyebrow="Профиль" title="Безопасность и мои данные" subtitle="Кто входил в учётную запись и что offix хранит о вас." />

      <Card style={{ gap: 4 }}>
        <Text variant="title">Последние входы</Text>
        <Text variant="small" tone="faint" style={{ marginBottom: 6 }}>
          {loginsNote(logins)}
        </Text>
        {q.isLoading ? (
          <Text tone="faint">Загружаем…</Text>
        ) : !logins.length ? (
          <Text tone="faint">Входов пока не было</Text>
        ) : (
          shown.map((l, i) => {
            const r = loginRow(l);
            const Icon = l.ok ? METHOD_ICON[l.method] : CircleAlert;
            const tint = l.ok ? p.accent : p.bad;
            return (
              <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: p.line }}>
                <View style={{ width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: l.ok ? p.accentSoft : p.badSoft }}>
                  <Icon size={16} color={tint} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontFamily: font.medium, color: l.ok ? p.ink : p.bad }}>{r.title}</Text>
                  <Text variant="caption" tone="faint">
                    {r.meta}
                  </Text>
                </View>
              </View>
            );
          })
        )}
        {logins.length > 6 && (
          <Pressable accessibilityRole="button" onPress={() => setAll((v) => !v)} style={{ paddingTop: 8 }}>
            <Text variant="small" tone="accent">
              {all ? 'Свернуть' : `Показать все (${logins.length})`}
            </Text>
          </Pressable>
        )}
      </Card>

      <Card style={{ gap: 12 }}>
        <Text variant="title">Что offix хранит обо мне</Text>
        <Text variant="small" tone="muted">
          Профиль, задачи, сообщения, заметки, файлы и входы — одним файлом. Его можно сохранить в «Файлы» или отправить себе. Исправить имя, почту и пароль можно в профиле, удалить данные — по просьбе к администратору.
        </Text>
        <Button title="Скачать мои данные" variant="secondary" icon={<Download size={16} color={p.ink} />} loading={busy} onPress={() => void download()} />
        <Button title="Политика обработки данных" variant="ghost" icon={<FileLock2 size={16} color={p.ink2} />} onPress={() => router.push('/privacy')} />
      </Card>
    </Screen>
  );
}
