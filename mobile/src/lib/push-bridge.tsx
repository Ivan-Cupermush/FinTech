import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { pushRoute } from '@offix/core';
import { configurePush, registerDevice } from './push';
import { api, useSession } from './session';

/**
 * Push внутри приложения: после входа (и при запуске) привязываем телефон,
 * если разрешение уже дано; пришедший push освежает «Входящие»; нажатие ведёт
 * на задачу или цель. Разрешение здесь не спрашиваем — только по кнопке.
 */
export function PushBridge() {
  const { token } = useSession();
  const qc = useQueryClient();
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    configurePush();
  }, []);

  useEffect(() => {
    if (token) void registerDevice(api).catch(() => false);
  }, [token]);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    });
    return () => sub.remove();
  }, [qc]);

  useEffect(() => {
    if (!token || !response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const data = response.notification.request.content.data as { notification_id?: string; task_id?: string | null; goal_id?: string | null } | undefined;
    if (data?.notification_id) {
      void api('/notifications/read', { body: { ids: [data.notification_id] } })
        .then(() => Promise.all([qc.invalidateQueries({ queryKey: ['notifications'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })]))
        .catch(() => undefined);
    }
    router.push(pushRoute(data));
  }, [token, response, qc]);

  return null;
}
