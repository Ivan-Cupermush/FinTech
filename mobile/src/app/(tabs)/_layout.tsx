import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/tabs';
import { Bell, LayoutGrid, ListChecks, Target } from 'lucide-react-native';
import { useDashboard } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { GlassTabBar } from '../../ui/fx/GlassTabBar';
import { TabBarSpaceProvider } from '../../ui/fx/TabBarSpace';

export default function TabsLayout() {
  const { ready, token } = useSession();
  const dash = useDashboard();
  if (ready && !token) return <Redirect href="/login" />;
  const unread = dash.data?.unread_notifications ?? 0;
  return (
    <TabBarSpaceProvider>
      <Tabs tabBar={(props) => <GlassTabBar {...props} />} screenOptions={{ headerShown: false, tabBarStyle: { position: 'absolute' } }}>
        <Tabs.Screen name="index" options={{ title: 'Пульс', tabBarIcon: ({ color }) => <LayoutGrid size={22} color={color} /> }} />
        <Tabs.Screen name="goals" options={{ title: 'Цели', tabBarIcon: ({ color }) => <Target size={22} color={color} /> }} />
        <Tabs.Screen name="tasks" options={{ title: 'Задачи', tabBarIcon: ({ color }) => <ListChecks size={22} color={color} /> }} />
        <Tabs.Screen name="inbox" options={{ title: 'Входящие', tabBarIcon: ({ color }) => <Bell size={22} color={color} />, tabBarBadge: unread ? unread : undefined }} />
      </Tabs>
    </TabBarSpaceProvider>
  );
}
