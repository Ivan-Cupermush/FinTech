import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'lucide-react-native';
import { useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import type { Me } from '@offix/core';
import { avatarsKey } from '../lib/avatars';
import { absUri, uploadPicked } from '../lib/files';
import { fromImageAsset } from '../lib/media';
import { api } from '../lib/session';
import { Avatar } from './primitives';

const SIZE = 44;

/**
 * Фото профиля: живое градиентное кольцо вокруг аватара. В профиле касание —
 * выбрать, снять или убрать фото; на Пульсе (onPress) — открыть профиль.
 * Пока грузится, кольцо — прогресс.
 */
export function ProfilePhoto({ me, onPress }: { me: Me; onPress?: () => void }) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  const has = !!me.avatar_url;

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: avatarsKey })]);

  const upload = async (camera: boolean) => {
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert('Нет доступа к камере', 'Разрешите offix пользоваться камерой в настройках телефона.');
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9, exif: false };
    const r = camera ? await ImagePicker.launchCameraAsync({ ...opts, cameraType: ImagePicker.CameraType.front }) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets[0]) return;
    setProgress(0);
    try {
      await uploadPicked<{ avatar_url: string }>(fromImageAsset(r.assets[0], 0), { path: '/files/avatar', onProgress: setProgress });
      await refresh();
    } catch (e) {
      Alert.alert('Фото не загрузилось', e instanceof Error ? e.message : 'Попробуйте ещё раз');
    } finally {
      setProgress(null);
    }
  };

  const remove = async () => {
    try {
      await api('/files/avatar', { method: 'DELETE' });
      await refresh();
    } catch (e) {
      Alert.alert('Не удалось убрать фото', e instanceof Error ? e.message : 'Попробуйте ещё раз');
    }
  };

  const run = (fn: () => Promise<unknown>) => () => void fn().catch((e) => Alert.alert('Не получилось', e instanceof Error ? e.message : ''));
  const items = [
    { label: has ? 'Выбрать другое фото' : 'Выбрать фото', run: run(() => upload(false)) },
    ...(Platform.OS !== 'web' ? [{ label: 'Сделать фото', run: run(() => upload(true)) }] : []),
    ...(has ? [{ label: 'Убрать фото', run: run(remove), danger: true }] : []),
  ];
  const open = () => {
    if (Platform.OS === 'web') return items[0]!.run();
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ title: 'Фото профиля', options: [...items.map((i) => i.label), 'Отмена'], cancelButtonIndex: items.length, destructiveButtonIndex: items.findIndex((i) => 'danger' in i) }, (i) => items[i]?.run());
      return;
    }
    Alert.alert('Фото профиля', undefined, [...items.map((i) => ({ text: i.label, onPress: i.run, style: 'danger' in i ? ('destructive' as const) : undefined })), { text: 'Отмена', style: 'cancel' as const }]);
  };

  const R = SIZE / 2 + 3;
  const len = 2 * Math.PI * R;
  const box = SIZE + 8;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={onPress ? 'Профиль' : 'Фото профиля'} accessibilityState={{ busy: progress !== null }} onPress={onPress ?? open} hitSlop={6} style={({ pressed }) => ({ width: box, height: box, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.94 : 1 }] })}>
      <Svg width={box} height={box} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="profile-ring" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#9ef0ff" />
            <Stop offset="0.5" stopColor="#8f7bff" />
            <Stop offset="1" stopColor="#ffcf8f" />
          </LinearGradient>
        </Defs>
        <Circle cx={box / 2} cy={box / 2} r={R} stroke={progress === null ? 'url(#profile-ring)' : 'rgba(255,255,255,0.25)'} strokeWidth={2.5} fill="none" />
        {progress !== null && <Circle cx={box / 2} cy={box / 2} r={R} stroke="#fff" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeDasharray={`${len} ${len}`} strokeDashoffset={len * (1 - progress)} transform={`rotate(-90 ${box / 2} ${box / 2})`} />}
      </Svg>
      <Avatar name={me.display_name} id={me.id} uri={absUri(me.avatar_url)} size={SIZE} />
      {progress !== null ? (
        <View style={{ position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(8,10,30,0.45)' }}>
          <ActivityIndicator color="#fff" size="small" />
        </View>
      ) : (
        <View style={{ position: 'absolute', right: 0, bottom: 0, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3b5bff', borderWidth: 1.5, borderColor: '#fff' }}>
          <Camera size={10} color="#fff" />
        </View>
      )}
    </Pressable>
  );
}
