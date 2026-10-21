import { router } from 'expo-router';
import { ArrowRight, Server } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/client';
import { useSession } from '../lib/session';
import { font, usePalette } from '../lib/theme';
import { LogoMark } from '../ui/domain';
import { Glass } from '../ui/fx/Glass';
import { Hero } from '../ui/fx/Hero';
import { Avatar, Button, Input, Text } from '../ui/primitives';

const DEMO = [
  { email: 'director@offix.demo', name: 'Алексей Петров', role: 'Проректор' },
  { email: 'olga@offix.demo', name: 'Ольга Смирнова', role: 'Руководитель офиса' },
  { email: 'dima@offix.demo', name: 'Дмитрий Орлов', role: 'Разработчик' },
  { email: 'anna@offix.demo', name: 'Анна Королёва', role: 'Специалист' },
];

export default function Login() {
  const p = usePalette();
  const session = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(session.server);
  const [showServer, setShowServer] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, e: string, pw: string) => {
    const local: Record<string, string> = {};
    if (!e.trim()) local.email = 'Введите почту';
    if (!pw) local.password = 'Введите пароль';
    setErrors(local);
    setMessage(null);
    if (Object.keys(local).length) return;
    setBusy(key);
    try {
      await session.login(e, pw, server);
      router.replace('/(tabs)');
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setMessage(Object.keys(err.fields).length ? null : err.message);
        if (err.isNetwork) setShowServer(true);
      } else setMessage('Что-то пошло не так');
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 22, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <Hero style={{ marginTop: 4 }}>
            <View style={{ minHeight: 300, padding: 20, justifyContent: 'space-between', gap: 24 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <LogoMark size={30} />
                <Text style={{ fontFamily: font.bold, fontSize: 20, letterSpacing: -0.6, color: '#fff' }}>offix</Text>
              </View>
              <View style={{ gap: 14 }}>
                <Text variant="h1" style={{ color: '#fff', fontSize: 32, lineHeight: 34, letterSpacing: -1.2 }}>
                  Цели, которые{'\n'}двигают цифры
                </Text>
                <Glass radius={18} style={{ alignSelf: 'flex-start' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: 14, paddingVertical: 10 }} accessibilityLabel="Время согласования: было 40, сейчас 36,5, цель 30 минут">
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: font.semibold, fontSize: 18 }}>40 →</Text>
                    <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: 22 }}>36,5</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: font.semibold, fontSize: 18 }}>→ 30 мин</Text>
                  </View>
                </Glass>
              </View>
            </View>
          </Hero>
          <Text tone="muted">Войдите, чтобы увидеть, что под угрозой и кому нужна помощь.</Text>
          <View style={{ gap: 14 }}>
            <Input label="Почта" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={errors.email} placeholder="name@company.ru" />
            <Input label="Пароль" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" error={errors.password} onSubmitEditing={() => run('form', email, password)} />
            {message && (
              <View accessibilityRole="alert" style={{ backgroundColor: p.badSoft, borderRadius: 12, padding: 12 }}>
                <Text variant="small" tone="bad">
                  {message}
                </Text>
              </View>
            )}
            <Button title="Войти" onPress={() => run('form', email, password)} loading={busy === 'form'} icon={<ArrowRight size={18} color={p.bg} />} />
          </View>
          <View style={{ gap: 10 }}>
            <Text variant="eyebrow" tone="faint">
              Демо-университет · вход в один тап
            </Text>
            <View style={{ backgroundColor: p.surface, borderRadius: 20, borderWidth: 1, borderColor: p.line }}>
              {DEMO.map((d, i) => (
                <Pressable
                  key={d.email}
                  accessibilityRole="button"
                  accessibilityLabel={`Войти как ${d.name}`}
                  disabled={!!busy}
                  onPress={() => run(d.email, d.email, 'offix-demo')}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: p.line, opacity: pressed || busy === d.email ? 0.6 : 1 })}
                >
                  <Avatar name={d.name} size={34} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: font.medium }}>{d.name}</Text>
                    <Text variant="caption" tone="faint">
                      {d.role}
                    </Text>
                  </View>
                  <ArrowRight size={16} color={p.ink3} />
                </Pressable>
              ))}
            </View>
          </View>
          <View style={{ gap: 10, marginTop: 'auto' }}>
            <Pressable onPress={() => setShowServer((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityRole="button">
              <Server size={14} color={p.ink3} />
              <Text variant="caption" tone="faint">
                Сервер: {server}
              </Text>
            </Pressable>
            <Pressable onPress={() => router.push('/licenses')} accessibilityRole="link">
              <Text variant="caption" tone="faint" style={{ textDecorationLine: 'underline' }}>
                Лицензии и благодарности
              </Text>
            </Pressable>
            {showServer && <Input label="Адрес сервера" value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" hint="Например, https://offix.example.ru — /api/v1 добавим сами" />}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
