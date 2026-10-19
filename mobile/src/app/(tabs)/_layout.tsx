import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/tabs';
import { Bell, LayoutGrid, ListChecks, Target } from 'lucide-react-native';
import { useDashboard } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { font, usePalette } from '../../lib/theme';

export default function TabsLayout() {
  const { ready, token } = useSession();
  const p = usePalette();
  const dash = useDashboard();
  if (ready && !token) return <Redirect href="/login" />;
  const unread = dash.data?.unread_notifications ?? 0;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: p.ink,
        tabBarInactiveTintColor: p.ink3,
        tabBarStyle: { backgroundColor: p.bg, borderTopColor: p.line },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 11, lineHeight: 14 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Пульс', tabBarIcon: ({ color }) => <LayoutGrid size={22} color={color} /> }} />
      <Tabs.Screen name="goals" options={{ title: 'Цели', tabBarIcon: ({ color }) => <Target size={22} color={color} /> }} />
      <Tabs.Screen name="tasks" options={{ title: 'Задачи', tabBarIcon: ({ color }) => <ListChecks size={22} color={color} /> }} />
      <Tabs.Screen
        name="inbox"
        options={{ title: 'Входящие', tabBarIcon: ({ color }) => <Bell size={22} color={color} />, tabBarBadge: unread ? unread : undefined, tabBarBadgeStyle: { backgroundColor: p.bad, fontSize: 10 } }}
      />
    </Tabs>
  );
}
