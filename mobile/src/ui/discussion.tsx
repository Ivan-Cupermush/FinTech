import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { MessageSquare } from 'lucide-react-native';
import { View } from 'react-native';
import type { DiscussionEntity, DiscussionSummary } from '@offix/core';
import { discussionLine } from '../lib/logic';
import { api } from '../lib/session';
import { font, usePalette } from '../lib/theme';
import { Card, Text } from './primitives';

export const discussionSummaryKey = (type: DiscussionEntity, id: string) => ['discussion-summary', type, id] as const;

export function useDiscussionSummary(type: DiscussionEntity, id: string | undefined) {
  return useQuery({ queryKey: discussionSummaryKey(type, id ?? ''), queryFn: () => api<DiscussionSummary>(`/discussions/${type}/${id}/summary`), enabled: !!id, staleTime: 15_000 });
}

/** Строка «Обсуждение» на экране цели и задачи: сколько комментариев и сколько новых. */
export function DiscussionLink({ type, id }: { type: DiscussionEntity; id: string }) {
  const p = usePalette();
  const s = useDiscussionSummary(type, id);
  const line = discussionLine(s.data);
  return (
    <Card onPress={() => router.push(`/discussion/${type}/${id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <MessageSquare size={20} color={p.ink2} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: font.semibold }}>Обсуждение</Text>
        <Text variant="small" tone="faint">
          {line.text}
        </Text>
      </View>
      {line.unread > 0 && (
        <View accessibilityLabel={`новых: ${line.unread}`} style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="caption" style={{ color: p.accentInk }}>
            {line.unread}
          </Text>
        </View>
      )}
    </Card>
  );
}
