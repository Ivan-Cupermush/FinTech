import { router, Stack, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, LaptopMinimal, MonitorSmartphone, ShieldAlert, XCircle } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isQrLoginToken, type QrLoginInfo } from '@offix/core';
import { ApiError } from '../../lib/client';
import { accountApi } from '../../lib/personal-api';
import { useMe } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { font } from '../../lib/theme';
import { LogoMark } from '../../ui/domain';
import { Glass } from '../../ui/fx/Glass';
import { GradientBackdrop } from '../../ui/fx/GradientBackdrop';
import { Button, Text } from '../../ui/primitives';

type View_ = { kind: 'loading' } | { kind: 'info'; info: QrLoginInfo } | { kind: 'error'; title: string; text: string };

function errorView(e: unknown): View_ {
  if (e instanceof ApiError && e.status === 403) return { kind: 'error', title: 'Код уже занят', text: 'Этот код отсканировал другой человек. Без подтверждения вход не выдаётся — просто закройте экран.' };
  if (e instanceof ApiError && e.status === 409) return { kind: 'error', title: 'Код устарел', text: 'Обновите страницу входа на компьютере и отсканируйте новый код.' };
  if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return { kind: 'error', title: 'Код не найден', text: 'Обновите страницу входа на компьютере и отсканируйте новый код.' };
  return { kind: 'error', title: 'Не получилось', text: e instanceof Error ? e.message : 'Нет связи с сервером. Попробуйте ещё раз.' };
}

/**
 * Телефон отсканировал код входа: какое устройство просит вход — и явное
 * «Подтвердить». Без него компьютер сеанса не получит.
 */
export default function QrConfirmScreen() {
  const { token: code = '' } = useLocalSearchParams<{ token: string }>();
  const { token } = useSession();
  const me = useMe();
  const insets = useSafeAreaInsets();
  const valid = isQrLoginToken(code);
  const [view, setView] = useState<View_>(valid ? { kind: 'loading' } : { kind: 'error', title: 'Это не код входа offix', text: 'Проверьте, что сканируете код со страницы входа offix.' });
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    if (!valid) return;
    let live = true;
    accountApi.qrInfo(code).then(
      (info) => live && setView({ kind: 'info', info }),
      (e) => live && setView(errorView(e)),
    );
    return () => {
      live = false;
    };
  }, [token, code, valid]);

  const answer = async (how: 'approve' | 'decline') => {
    setBusy(how);
    try {
      setView({ kind: 'info', info: how === 'approve' ? await accountApi.qrApprove(code) : await accountApi.qrDecline(code) });
    } catch (e) {
      setView(errorView(e));
    } finally {
      setBusy(null);
    }
  };
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const info = view.kind === 'info' ? view.info : null;
  const waiting = info && (info.status === 'scanned' || info.status === 'pending');
  const white = { color: '#fff' };
  const soft = { color: 'rgba(255,255,255,0.8)' };
  return (
    <View style={{ flex: 1, backgroundColor: '#090b2a' }}>
      <Stack.Screen options={{ headerShown: false }} />
      <GradientBackdrop variant="hero" />
      <View style={{ flex: 1, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20, paddingHorizontal: 18, justifyContent: 'center', gap: 22 }}>
        <View style={{ alignItems: 'center' }}>
          <LogoMark size={34} />
        </View>
        <Glass radius={30}>
          <View accessibilityLiveRegion="polite" style={{ padding: 22, gap: 14, alignItems: 'center' }}>
            {view.kind === 'loading' && <Text style={white}>Проверяем код…</Text>}
            {view.kind === 'error' && (
              <>
                <ShieldAlert size={40} color="#fff" />
                <Text accessibilityRole="header" variant="h2" style={[white, { textAlign: 'center' }]}>
                  {view.title}
                </Text>
                <Text style={[soft, { textAlign: 'center' }]}>{view.text}</Text>
                <Button title="Закрыть" variant="secondary" onPress={leave} style={{ alignSelf: 'stretch' }} />
              </>
            )}
            {info && waiting && (
              <>
                <View style={{ width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' }}>
                  {info.device.kind === 'phone' || info.device.kind === 'tablet' ? <MonitorSmartphone size={30} color="#fff" /> : <LaptopMinimal size={30} color="#fff" />}
                </View>
                <Text accessibilityRole="header" variant="h2" style={[white, { textAlign: 'center' }]}>
                  Войти в offix на этом устройстве?
                </Text>
                <View style={{ alignSelf: 'stretch', gap: 8, padding: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)' }}>
                  {[
                    ['Устройство', info.device.label],
                    ...(info.ip ? [['IP-адрес', info.ip]] : []),
                    ['Аккаунт', me.data ? `${me.data.display_name} · ${me.data.company_name}` : '…'],
                  ].map(([k, v]) => (
                    <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                      <Text variant="small" style={soft}>
                        {k}
                      </Text>
                      <Text variant="small" style={[white, { fontFamily: font.semibold, flexShrink: 1, textAlign: 'right' }]}>
                        {v}
                      </Text>
                    </View>
                  ))}
                </View>
                <Text variant="small" style={[soft, { textAlign: 'center' }]}>
                  Подтверждайте, только если сами открыли страницу входа на этом компьютере. Никому не пересылайте эту ссылку.
                </Text>
                <View style={{ alignSelf: 'stretch', gap: 8 }}>
                  <Button title="Подтвердить вход" variant="accent" icon={<CheckCircle2 size={18} color="#fff" />} loading={busy === 'approve'} disabled={!!busy} onPress={() => void answer('approve')} />
                  <Button title="Отклонить" variant="ghost" loading={busy === 'decline'} disabled={!!busy} onPress={() => void answer('decline')} style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />
                </View>
              </>
            )}
            {info && !waiting && (
              <>
                {info.status === 'approved' ? <CheckCircle2 size={40} color="#fff" /> : <XCircle size={40} color="#fff" />}
                <Text accessibilityRole="header" variant="h2" style={[white, { textAlign: 'center' }]}>
                  {info.status === 'approved' ? 'Вход подтверждён' : info.status === 'declined' ? 'Вход отклонён' : 'Код устарел'}
                </Text>
                <Text style={[soft, { textAlign: 'center' }]}>{info.status === 'approved' ? `На устройстве «${info.device.label}» открывается offix.` : info.status === 'declined' ? 'Компьютер не получил доступ к вашему аккаунту.' : 'Обновите страницу входа на компьютере и отсканируйте новый код.'}</Text>
                <Button title="Готово" variant="secondary" onPress={leave} style={{ alignSelf: 'stretch' }} />
              </>
            )}
          </View>
        </Glass>
      </View>
    </View>
  );
}
