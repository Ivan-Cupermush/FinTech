import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { BarChart3, BellRing, BookOpen, ChevronRight, KeyRound, LaptopMinimal, LogOut, NotebookPen, Pencil, ScanLine, Share2, Sparkles, UserRound, Wallet } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Alert, Platform, Pressable, Share, View } from 'react-native';
import { COMPANY_ROLE_LABELS, PASSWORD_STRENGTH_LABELS, displayNameError, passwordError, passwordStrength, profileUrl } from '@offix/core';
import { ApiError } from '../lib/client';
import { lastLoginText, siteOrigin, STRENGTH_COLORS } from '../lib/personal';
import { accountApi, mk, useProfile } from '../lib/personal-api';
import { useMe } from '../lib/queries';
import { useSession } from '../lib/session';
import { font, usePalette } from '../lib/theme';
import { GradientBackdrop } from '../ui/fx/GradientBackdrop';
import { MyFunctionsCard } from '../ui/functions';
import { Glass } from '../ui/fx/Glass';
import { PageHero } from '../ui/fx/PageHero';
import { Button, Card, Input, Screen, Text } from '../ui/primitives';
import { ProfilePhoto } from '../ui/profile';
import { QrCode } from '../ui/qr';

const errText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : e instanceof Error ? e.message : 'Не получилось');

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon}
        <Text variant="title">{title}</Text>
      </View>
      {children}
    </Card>
  );
}

function MenuRow({ icon, label, onPress, first, danger }: { icon: ReactNode; label: string; onPress: () => void; first?: boolean; danger?: boolean }) {
  const p = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: first ? 0 : 1, borderTopColor: p.line, opacity: pressed ? 0.6 : 1 })}>
      {icon}
      <Text style={{ flex: 1, color: danger ? p.bad : p.ink }}>{label}</Text>
      {!danger && <ChevronRight size={18} color={p.ink3} />}
    </Pressable>
  );
}

/** Профиль: имя, мой QR, сканер кода входа, пароль и выход на всех устройствах. */
export default function ProfileScreen() {
  const p = usePalette();
  const qc = useQueryClient();
  const me = useMe();
  const q = useProfile();
  const { server, applyToken, logout } = useSession();
  const pr = q.data;
  const [editName, setEditName] = useState<string | null>(null);
  const [nameBusy, setNameBusy] = useState(false);
  const [pwd, setPwd] = useState({ current: '', next: '', repeat: '' });
  const [pwdErr, setPwdErr] = useState<Record<string, string>>({});
  const [pwdBusy, setPwdBusy] = useState(false);
  const strength = passwordStrength(pwd.next);
  const url = pr ? profileUrl(siteOrigin(server), pr.id) : '';

  const saveName = async () => {
    if (editName === null || displayNameError(editName)) return;
    setNameBusy(true);
    try {
      const next = await accountApi.rename(editName.trim());
      qc.setQueryData(mk.profile, next);
      void qc.invalidateQueries({ queryKey: ['me'] });
      setEditName(null);
    } catch (e) {
      Alert.alert('Имя не сохранилось', errText(e));
    } finally {
      setNameBusy(false);
    }
  };

  const changePassword = async () => {
    if (!pr) return;
    const e: Record<string, string> = {};
    if (!pwd.current) e.current_password = 'Введите текущий пароль';
    const pe = passwordError(pwd.next, { email: pr.email, name: pr.display_name });
    if (pe) e.new_password = pe;
    else if (pwd.next !== pwd.repeat) e.repeat = 'Пароли не совпадают';
    setPwdErr(e);
    if (Object.keys(e).length) return;
    setPwdBusy(true);
    try {
      const r = await accountApi.password(pwd.current, pwd.next);
      await applyToken(r.token);
      setPwd({ current: '', next: '', repeat: '' });
      Alert.alert('Пароль изменён', 'На других устройствах нужно войти заново.');
    } catch (x) {
      setPwdErr(x instanceof ApiError && Object.keys(x.fields).length ? x.fields : { current_password: errText(x) });
    } finally {
      setPwdBusy(false);
    }
  };

  const signOut = () => void logout().then(() => router.replace('/login'));
  const logoutAll = () => {
    const run = async (keep: boolean) => {
      try {
        const r = await accountApi.logoutAll(keep);
        if (r.token) {
          await applyToken(r.token);
          Alert.alert('Готово', 'Другие устройства вышли из offix.');
        } else signOut();
      } catch (e) {
        Alert.alert('Не получилось', errText(e));
      }
    };
    if (Platform.OS === 'web') return void run(true);
    Alert.alert('Выйти на всех устройствах?', 'Сайт и другие телефоны выйдут из offix. Пригодится, если потеряли телефон или входили на чужом компьютере.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'И здесь тоже', style: 'destructive', onPress: () => void run(false) },
      { text: 'Выйти на остальных', onPress: () => void run(true) },
    ]);
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Stack.Screen options={{ title: 'Профиль' }} />
      <PageHero
        variant="profile"
        icon={UserRound}
        eyebrow="Профиль"
        title={pr?.display_name ?? me.data?.display_name ?? ' '}
        subtitle={pr ? [COMPANY_ROLE_LABELS[pr.role], pr.company_name, pr.position].filter(Boolean).join(' · ') : undefined}
        right={me.data ? <ProfilePhoto me={me.data} /> : undefined}
      />

      {pr && (
        <>
          <View style={{ borderRadius: 28, overflow: 'hidden', backgroundColor: '#0a0c2e' }}>
            <GradientBackdrop variant="profile" />
            <View style={{ padding: 16, gap: 14, alignItems: 'center' }}>
              <Glass radius={28}>
                <View style={{ padding: 14 }}>
                  <QrCode value={url} size={210} label={`QR-код профиля: ${pr.display_name}`} />
                </View>
              </Glass>
              <Text variant="small" style={{ color: 'rgba(255,255,255,0.82)', textAlign: 'center', maxWidth: 300 }}>
                Покажите код коллеге — его камера откроет вашу карточку в offix.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable accessibilityRole="button" accessibilityLabel="Сканировать QR" onPress={() => router.push('/scan')} hitSlop={6}>
                  <Glass radius={20} style={{ height: 40, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ScanLine size={17} color="#fff" />
                    <Text style={{ color: '#fff', fontFamily: font.semibold, fontSize: 14 }}>Сканировать QR</Text>
                  </Glass>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Поделиться ссылкой на профиль" onPress={() => void Share.share({ message: url })} hitSlop={6}>
                  <Glass radius={20} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                    <Share2 size={17} color="#fff" />
                  </Glass>
                </Pressable>
              </View>
            </View>
          </View>

          <Section icon={<UserRound size={18} color={p.ink} />} title="Обо мне">
            {editName === null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontFamily: font.semibold }}>{pr.display_name}</Text>
                  <Text variant="small" tone="faint">
                    {pr.email}
                  </Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Изменить имя" onPress={() => setEditName(pr.display_name)} hitSlop={8}>
                  <Pencil size={18} color={p.ink2} />
                </Pressable>
              </View>
            ) : (
              <>
                <Input label="Как вас видят коллеги" value={editName} onChangeText={setEditName} autoFocus error={displayNameError(editName)} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title="Отмена" variant="ghost" style={{ flex: 1 }} onPress={() => setEditName(null)} />
                  <Button title="Сохранить" variant="accent" style={{ flex: 1 }} loading={nameBusy} disabled={!!displayNameError(editName)} onPress={() => void saveName()} />
                </View>
              </>
            )}
          </Section>

          <MyFunctionsCard />

          <Section icon={<KeyRound size={18} color={p.ink} />} title="Пароль">
            <Input label="Текущий пароль" value={pwd.current} onChangeText={(v) => setPwd({ ...pwd, current: v })} secureTextEntry autoComplete="current-password" error={pwdErr.current_password} />
            <Input label="Новый пароль" value={pwd.next} onChangeText={(v) => setPwd({ ...pwd, next: v })} secureTextEntry autoComplete="new-password" error={pwdErr.new_password} hint="Не короче 8 символов. Фраза из нескольких слов надёжнее «P@ssw0rd»." />
            {!!pwd.next && (
              <View accessible accessibilityLabel={`Надёжность: ${PASSWORD_STRENGTH_LABELS[strength]}`} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {[0, 1, 2, 3].map((i) => (
                    <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= strength ? STRENGTH_COLORS[strength] : p.surface3 }} />
                  ))}
                </View>
                <Text variant="caption" style={{ color: STRENGTH_COLORS[strength] }}>
                  {PASSWORD_STRENGTH_LABELS[strength]}
                </Text>
              </View>
            )}
            <Input label="Повторите новый пароль" value={pwd.repeat} onChangeText={(v) => setPwd({ ...pwd, repeat: v })} secureTextEntry autoComplete="new-password" error={pwdErr.repeat} />
            <Button title="Сменить пароль" variant="primary" icon={<KeyRound size={16} color={p.bg} />} loading={pwdBusy} onPress={() => void changePassword()} />
          </Section>

          <Section icon={<LaptopMinimal size={18} color={p.ink} />} title="Сеансы и вход">
            <Text variant="small" tone="faint">
              {lastLoginText(pr)}
            </Text>
            <Text variant="small" tone="muted">
              Войти на компьютере без пароля: на странице входа выберите «По QR-коду с телефона» и отсканируйте код здесь, кнопкой «Сканировать QR». Вход подтверждается на телефоне.
            </Text>
            <Button title="Выйти на всех устройствах" variant="danger" icon={<LogOut size={16} color={p.bad} />} onPress={logoutAll} />
          </Section>
        </>
      )}

      <Card style={{ gap: 0, paddingVertical: 2 }}>
        <MenuRow first icon={<NotebookPen size={18} color={p.ink2} />} label="Мои заметки" onPress={() => router.push('/my-notes')} />
        <MenuRow icon={<BookOpen size={18} color={p.ink2} />} label="База знаний" onPress={() => router.push('/notes')} />
        <MenuRow icon={<Sparkles size={18} color={p.ink2} />} label="Эффект" onPress={() => router.push('/effect')} />
        <MenuRow icon={<BarChart3 size={18} color={p.ink2} />} label="Отчёт" onPress={() => router.push('/report')} />
        <MenuRow icon={<Wallet size={18} color={p.ink2} />} label="Продажи и KPI" onPress={() => router.push('/sales')} />
        <MenuRow icon={<BellRing size={18} color={p.ink2} />} label="Push-уведомления" onPress={() => router.push('/push-settings')} />
        <MenuRow icon={<LogOut size={18} color={p.bad} />} label="Выйти" danger onPress={signOut} />
      </Card>
    </Screen>
  );
}
