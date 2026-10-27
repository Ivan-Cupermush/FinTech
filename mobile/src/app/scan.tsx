import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, Stack } from 'expo-router';
import { Link2, ScanLine, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scanTarget } from '../lib/personal';
import { font, usePalette } from '../lib/theme';
import { Glass } from '../ui/fx/Glass';
import { GradientBackdrop } from '../ui/fx/GradientBackdrop';
import { Button, Input, Text } from '../ui/primitives';

/**
 * Сканер QR: код входа на сайте открывает подтверждение, код профиля —
 * карточку коллеги. Камера читает один код и останавливается.
 */
export default function ScanScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [perm, request] = useCameraPermissions();
  const [manual, setManual] = useState(Platform.OS === 'web');
  const [link, setLink] = useState('');
  const done = useRef(false);

  const handle = (raw: string) => {
    if (done.current) return;
    const t = scanTarget(raw);
    if (t.kind === 'route') {
      done.current = true;
      router.replace(t.path as never);
      return;
    }
    done.current = true;
    const again = () => setTimeout(() => (done.current = false), 600);
    if (t.kind === 'url') {
      Alert.alert('Это не код offix', t.url, [
        { text: 'Отмена', style: 'cancel', onPress: again },
        { text: 'Открыть ссылку', onPress: () => void Linking.openURL(t.url).finally(again) },
      ]);
      return;
    }
    Alert.alert('Это не код offix', 'Наведите камеру на код со страницы входа offix или из профиля коллеги.', [{ text: 'Понятно', onPress: again }]);
  };

  const close = (
    <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))} hitSlop={10}>
      <Glass radius={20} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
        <X size={20} color="#fff" />
      </Glass>
    </Pressable>
  );

  const camera = perm?.granted && !manual;
  return (
    <View style={{ flex: 1, backgroundColor: '#05061a' }}>
      <Stack.Screen options={{ headerShown: false }} />
      {camera ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(r) => handle(r.data)} />
      ) : (
        <GradientBackdrop variant="profile" />
      )}
      <View style={{ flex: 1, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16, paddingHorizontal: 16, justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Glass radius={20} style={{ height: 40, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ScanLine size={17} color="#fff" />
            <Text style={{ color: '#fff', fontFamily: font.semibold }}>Сканировать QR</Text>
          </Glass>
          {close}
        </View>

        {camera ? (
          <View pointerEvents="none" style={{ alignSelf: 'center', width: 250, height: 250, borderRadius: 36, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' }} />
        ) : (
          <Glass radius={28}>
            <View style={{ padding: 18, gap: 12 }}>
              {manual ? (
                <>
                  <Text style={{ color: '#fff', fontFamily: font.semibold, fontSize: 17 }}>Ссылка из QR-кода</Text>
                  <Text variant="small" style={{ color: 'rgba(255,255,255,0.8)' }}>
                    Вставьте ссылку со страницы входа offix или из профиля коллеги.
                  </Text>
                  <Input label="Ссылка" value={link} onChangeText={setLink} placeholder="https://…/qr/…" autoCapitalize="none" autoCorrect={false} keyboardType="url" style={{ backgroundColor: 'rgba(255,255,255,0.92)', color: '#141625' }} />
                  <Button title="Открыть" variant="accent" disabled={!link.trim()} onPress={() => handle(link)} />
                </>
              ) : (
                <>
                  <Text style={{ color: '#fff', fontFamily: font.semibold, fontSize: 17 }}>Нужен доступ к камере</Text>
                  <Text variant="small" style={{ color: 'rgba(255,255,255,0.8)' }}>
                    Камера нужна только чтобы прочитать код. Снимки не сохраняются и никуда не отправляются.
                  </Text>
                  {perm?.canAskAgain === false ? <Button title="Открыть настройки" variant="accent" onPress={() => void Linking.openSettings()} /> : <Button title="Разрешить камеру" variant="accent" onPress={() => void request()} />}
                </>
              )}
            </View>
          </Glass>
        )}

        <View style={{ gap: 10, alignItems: 'center' }}>
          {camera && (
            <Text style={{ color: '#fff', textAlign: 'center', maxWidth: 300 }}>
              Наведите камеру на код со страницы входа offix или из профиля коллеги
            </Text>
          )}
          {Platform.OS !== 'web' && (
            <Pressable accessibilityRole="button" onPress={() => setManual((m) => !m)} hitSlop={8}>
              <Glass radius={18} style={{ height: 36, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Link2 size={15} color="#fff" />
                <Text variant="caption" style={{ color: '#fff' }}>
                  {manual ? 'Сканировать камерой' : 'Ввести ссылку'}
                </Text>
              </Glass>
            </Pressable>
          )}
          <View style={{ height: 1, width: 1, backgroundColor: p.bg, opacity: 0 }} />
        </View>
      </View>
    </View>
  );
}
