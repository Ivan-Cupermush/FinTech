import { Onest_400Regular, Onest_500Medium, Onest_600SemiBold, Onest_700Bold, useFonts } from '@expo-google-fonts/onest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Platform, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AvatarProvider } from '../lib/avatars';
import { ChatLive } from '../lib/chats';
import { ApiError } from '../lib/client';
import { PushBridge } from '../lib/push-bridge';
import { SessionProvider } from '../lib/session';
import { font, usePalette } from '../lib/theme';

export default function RootLayout() {
  const [loaded] = useFonts({ Onest_400Regular, Onest_500Medium, Onest_600SemiBold, Onest_700Bold });
  const scheme = useColorScheme();
  const p = usePalette();
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2, staleTime: 10_000 } },
      }),
  );
  if (!loaded) return <View style={{ flex: 1, backgroundColor: p.bg }} />;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <SessionProvider>
          {Platform.OS !== 'web' && <PushBridge />}
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <ChatLive>
            <AvatarProvider>
            <Stack
              screenOptions={{
                headerShadowVisible: false,
                headerStyle: { backgroundColor: p.bg },
                headerTintColor: p.ink,
                headerTitleStyle: { fontFamily: font.semibold, fontSize: 16 },
                headerBackTitle: 'Назад',
                contentStyle: { backgroundColor: p.bg },
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="goal/[id]" options={{ title: 'Цель' }} />
              <Stack.Screen name="goal/new" options={{ title: 'Новая цель', presentation: 'modal' }} />
              <Stack.Screen name="task/[id]" options={{ title: 'Задача', presentation: 'modal' }} />
              <Stack.Screen name="request" options={{ title: 'Новая просьба', presentation: 'modal' }} />
              <Stack.Screen name="effect" options={{ title: 'Эффект' }} />
              <Stack.Screen name="report" options={{ title: 'Отчёт' }} />
              <Stack.Screen name="push-settings" options={{ title: 'Уведомления' }} />
              <Stack.Screen name="discussion/[type]/[id]" options={{ title: 'Обсуждение', headerShown: false }} />
              <Stack.Screen name="notes/index" options={{ title: 'База знаний' }} />
              <Stack.Screen name="notes/[id]" options={{ title: 'Заметка' }} />
              <Stack.Screen name="licenses" options={{ title: 'Лицензии' }} />
              <Stack.Screen name="chat/[id]/index" options={{ headerShown: false }} />
              <Stack.Screen name="chat/[id]/info" options={{ title: 'Информация' }} />
              <Stack.Screen name="chat/[id]/members" options={{ title: 'Добавить участников', presentation: 'modal' }} />
              <Stack.Screen name="chat/[id]/topics" options={{ title: 'Темы' }} />
              <Stack.Screen name="chat/[id]/media" options={{ title: 'Медиа и файлы' }} />
              <Stack.Screen name="chat/new" options={{ title: 'Новый чат', presentation: 'modal' }} />
              <Stack.Screen name="my-notes/index" options={{ title: 'Мои заметки' }} />
              <Stack.Screen name="my-notes/[id]" options={{ title: 'Заметка' }} />
              <Stack.Screen name="my-notes/send" options={{ title: 'Отправить в чат', presentation: 'modal' }} />
              <Stack.Screen name="my-notes/pick" options={{ title: 'Отправить заметку', presentation: 'modal' }} />
              <Stack.Screen name="note-share/[id]" options={{ title: 'Заметка из чата' }} />
              <Stack.Screen name="note-request/[id]" options={{ title: 'Запрос заметки' }} />
              <Stack.Screen name="profile" options={{ title: 'Профиль' }} />
              <Stack.Screen name="person/[id]" options={{ title: 'Коллега' }} />
              <Stack.Screen name="scan" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
              <Stack.Screen name="qr/[token]" options={{ headerShown: false }} />
            </Stack>
            </AvatarProvider>
          </ChatLive>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
