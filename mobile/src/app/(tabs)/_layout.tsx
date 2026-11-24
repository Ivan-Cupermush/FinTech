import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/tabs';
import { CalendarDays, ListChecks, MessagesSquare, Target, TrendingUp } from 'lucide-react-native';
import { useChatsUnread } from '../../lib/chats';
import { isModuleOn } from '@offix/core';
import { useMe } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { GlassTabBar } from '../../ui/fx/GlassTabBar';
import { TabBarSpaceProvider } from '../../ui/fx/TabBarSpace';

export default function TabsLayout() {
  const { ready, token } = useSession();
  const me = useMe();
  // Чаты выключены в «Функциях компании» — вкладки нет и счётчик не спрашиваем.
  const chatsOn = isModuleOn(me.data?.modules, 'chats');
  const chats = useChatsUnread(!!token && chatsOn);
  if (ready && !token) return <Redirect href="/login" />;
  const chatsUnread = chats.data?.unread ?? 0;
  return (
    <TabBarSpaceProvider>
      <Tabs tabBar={(props) => <GlassTabBar {...props} />} screenOptions={{ headerShown: false, tabBarStyle: { position: 'absolute' } }}>
        <Tabs.Screen name="tasks" options={{ title: 'Задачи', tabBarIcon: ({ color }) => <ListChecks size={22} color={color} /> }} />
        <Tabs.Screen name="goals" options={{ title: 'Цели', tabBarIcon: ({ color }) => <Target size={22} color={color} /> }} />
        <Tabs.Screen name="effect" options={{ title: 'KPI', tabBarIcon: ({ color }) => <TrendingUp size={22} color={color} /> }} />
        <Tabs.Screen name="chats" options={{ title: 'Чаты', tabBarIcon: ({ color }) => <MessagesSquare size={22} color={color} />, tabBarBadge: chatsUnread ? (chatsUnread > 99 ? '99+' : chatsUnread) : undefined, ...(chatsOn ? {} : { href: null }) }} />
        <Tabs.Screen name="meetings" options={{ title: 'Совещания', tabBarIcon: ({ color }) => <CalendarDays size={22} color={color} /> }} />
        <Tabs.Screen name="inbox" options={{ href: null }} />
      </Tabs>
    </TabBarSpaceProvider>
  );
}
