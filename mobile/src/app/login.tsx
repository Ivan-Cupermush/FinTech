import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ArrowRight, FlaskConical, Server } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { COMPANY_ROLE_LABELS, type SandboxInfo } from '@offix/core';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, createClient, normalizeBaseUrl } from '../lib/client';
import { roleLine, sandboxPeople } from '../lib/modules';
import { useSession } from '../lib/session';
import { font, usePalette } from '../lib/theme';
import { LogoMark } from '../ui/domain';
import { Glass } from '../ui/fx/Glass';
import { GradientBackdrop } from '../ui/fx/GradientBackdrop';
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
  // Песочница для жюри: тот же сервер, что в поле адреса. Нет песочницы или нет связи — обычный вход.
  const probe = useMemo(() => createClient({ baseUrl: () => normalizeBaseUrl(server), token: () => null }), [server]);
  const sandbox = useQuery({ queryKey: ['sandbox', server], queryFn: () => probe<SandboxInfo>('/auth/sandbox'), retry: false, staleTime: 60_000 });
  const people = sandboxPeople(sandbox.data);

  const run = async (key: string, e: string, pw: string) => {
    const local: Record<string, string> = {};
    if (!e.trim()) local.email = people.length ? 'Введите логин или почту' : 'Введите почту';
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
          {/* Песочница — сразу под шапкой: жюри видит, под кем войти, без прокрутки. */}
          {people.length > 0 && (
            <View style={{ borderRadius: 28, overflow: 'hidden', backgroundColor: '#0a0c2e' }}>
              <GradientBackdrop variant="hero" />
              <View style={{ padding: 8 }}>
                <Glass radius={22}>
                  <View style={{ padding: 14, gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                        <FlaskConical size={18} color="#fff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text variant="caption" style={{ color: 'rgba(255,255,255,0.75)', fontFamily: font.semibold, letterSpacing: 0.6 }}>
                          ПЕСОЧНИЦА ДЛЯ ЖЮРИ
                        </Text>
                        <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: 18 }}>{sandbox.data?.company_name ?? 'Университет'}</Text>
                      </View>
                    </View>
                    <Text variant="small" style={{ color: 'rgba(255,255,255,0.86)' }}>
                      Продажи и выплаты выключены — университету они не нужны. Нажмите на сотрудника, чтобы войти; пароль совпадает с логином.
                    </Text>
                    {people.map((d) => (
                      <Pressable
                        key={d.login}
                        accessibilityRole="button"
                        accessibilityLabel={`Войти: ${d.display_name}, ${d.position}. Логин ${d.login}, пароль ${d.password}`}
                        disabled={!!busy}
                        onPress={() => {
                          setEmail(d.login);
                          setPassword(d.password);
                          void run(d.login, d.login, d.password);
                        }}
                        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.09)', opacity: pressed || busy === d.login ? 0.6 : 1 })}
                      >
                        <Avatar name={d.display_name} size={34} />
                        <View style={{ flex: 1, gap: 1 }}>
                          <Text style={{ color: '#fff', fontFamily: font.semibold }}>{d.display_name}</Text>
                          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.78)' }} numberOfLines={2}>
                            {roleLine(d.position, COMPANY_ROLE_LABELS[d.role])}
                          </Text>
                          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.92)', fontFamily: font.medium }}>
                            {busy === d.login ? 'Входим…' : `логин ${d.login} · пароль ${d.password}`}
                          </Text>
                        </View>
                        <ArrowRight size={16} color="rgba(255,255,255,0.7)" />
                      </Pressable>
                    ))}
                  </View>
                </Glass>
              </View>
            </View>
          )}
          <Text tone="muted">Войдите, чтобы увидеть, что под угрозой и кому нужна помощь.</Text>
          <View style={{ gap: 14 }}>
            {people.length ? (
              <Input label="Логин или почта" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="username" error={errors.email} placeholder="rector" />
            ) : (
              <Input label="Почта" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={errors.email} placeholder="name@company.ru" />
            )}
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
          {people.length === 0 && (
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
          )}
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
