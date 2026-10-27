import { router } from 'expo-router';
import { BookOpen, ChevronRight, FileText } from 'lucide-react-native';
import { View } from 'react-native';
import { docsLine } from '../lib/knowledge';
import { useKnowledgeDocs } from '../lib/knowledge-api';
import { notesLine, notesQuery } from '../lib/notes';
import { useNotes } from '../lib/queries';
import { font, usePalette } from '../lib/theme';
import { Card, Text } from './primitives';

/** Строка «Заметки» на экране цели — вход в базу знаний этой цели. */
export function NotesLink({ goalId, goalTitle }: { goalId: string; goalTitle: string }) {
  const p = usePalette();
  const q = useNotes(notesQuery({ goalId }));
  return (
    <Card onPress={() => router.push({ pathname: '/notes', params: { goal: goalId, goalTitle } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <BookOpen size={20} color={p.ink2} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: font.semibold }}>Заметки</Text>
        <Text variant="small" tone="faint">
          {notesLine(q.data?.length)}
        </Text>
      </View>
      <ChevronRight size={18} color={p.ink3} />
    </Card>
  );
}

/** Вход в общую базу знаний — во «Входящих», рядом с тем, что пришло. */
export function KnowledgeLink() {
  const p = usePalette();
  return (
    <Card onPress={() => router.push('/notes')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <BookOpen size={20} color={p.ink2} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: font.semibold }}>База знаний</Text>
        <Text variant="small" tone="faint">
          Регламенты, документы и помощник с ответами
        </Text>
      </View>
      <ChevronRight size={18} color={p.ink3} />
    </Card>
  );
}

/** Строка «Документы» на экране цели: файлы, по которым помощник отвечает о цели. */
export function GoalDocsLink({ goalId, goalTitle, canUpload }: { goalId: string; goalTitle: string; canUpload: boolean }) {
  const p = usePalette();
  const q = useKnowledgeDocs(goalId);
  return (
    <Card onPress={() => router.push({ pathname: '/notes', params: { goal: goalId, goalTitle, tab: 'docs', upload: canUpload ? '1' : '' } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <FileText size={20} color={p.ink2} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: font.semibold }}>Документы</Text>
        <Text variant="small" tone="faint">
          {docsLine(q.data)}
        </Text>
      </View>
      <ChevronRight size={18} color={p.ink3} />
    </Card>
  );
}
