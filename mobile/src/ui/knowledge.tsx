import { router } from 'expo-router';
import { AlertTriangle, ArrowUp, BookOpen, FileText, Info, RefreshCw, Sparkles, Target, ThumbsDown, ThumbsUp } from 'lucide-react-native';
import { Fragment, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { formatDate, KNOWLEDGE_LIMITS, KNOWLEDGE_MODE_LABEL, KNOWLEDGE_STATUS_LABEL, knowledgeDocBusy, knowledgeDocFacts, knowledgeDocTypeLabel, type KnowledgeDoc, type KnowledgeMessage, type KnowledgeSource } from '@offix/core';
import { heroColors } from '../lib/fx';
import { answerBlocks, sourceRoute } from '../lib/knowledge';
import { font, radius, toneColors, usePalette, type Tone } from '../lib/theme';
import { Glass } from './fx/Glass';
import { Card, NO_WEB_OUTLINE, Pill, Text } from './primitives';

const STATUS_TONE: Record<KnowledgeDoc['status'], Tone> = { pending: 'info', processing: 'accent', ready: 'good', failed: 'bad' };

export function DocStatusPill({ doc }: { doc: Pick<KnowledgeDoc, 'status'> }) {
  return (
    <Pill tone={STATUS_TONE[doc.status]} dot={knowledgeDocBusy(doc)}>
      {KNOWLEDGE_STATUS_LABEL[doc.status]}
    </Pill>
  );
}

/** Значок типа файла: PDF — красноватый, DOCX — синий, текст — нейтральный. */
export function DocBadge({ type, size = 40 }: { type: KnowledgeDoc['type']; size?: number }) {
  const p = usePalette();
  const c = toneColors(p, type === 'pdf' ? 'bad' : type === 'docx' ? 'accent' : 'neutral');
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c.fg, fontFamily: font.bold, fontSize: size * 0.26, letterSpacing: 0.2 }}>{knowledgeDocTypeLabel(type).slice(0, 4).toUpperCase()}</Text>
    </View>
  );
}

/** Строка документа: тип, название, сводка, статус и — если не прочитался — почему. */
export function DocRow({ doc, today, onRetry, retrying }: { doc: KnowledgeDoc; today: string; onRetry?: () => void; retrying?: boolean }) {
  const p = usePalette();
  return (
    <Card onPress={() => router.push(`/notes/doc/${doc.id}`)} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      <DocBadge type={doc.type} />
      <View style={{ flex: 1, gap: 5 }}>
        <Text style={{ fontFamily: font.semibold }} numberOfLines={2}>
          {doc.title}
        </Text>
        <Text variant="caption" tone="faint" numberOfLines={1}>
          {knowledgeDocFacts(doc)} · {formatDate(doc.created_at.slice(0, 10), { short: true, today })}
        </Text>
        {doc.goal_title && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Target size={12} color={p.ink3} />
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
              {doc.goal_title}
            </Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <DocStatusPill doc={doc} />
          {doc.can_edit && doc.status === 'failed' && onRetry && (
            <Pressable accessibilityRole="button" accessibilityLabel={`Обработать «${doc.title}» ещё раз`} onPress={onRetry} disabled={retrying} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {retrying ? <ActivityIndicator size="small" color={p.accent} /> : <RefreshCw size={13} color={p.accent} />}
              <Text variant="caption" tone="accent">
                Ещё раз
              </Text>
            </Pressable>
          )}
        </View>
        {doc.status === 'failed' && doc.error && (
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
            <AlertTriangle size={13} color={p.bad} style={{ marginTop: 2 }} />
            <Text variant="small" tone="bad" style={{ flex: 1 }}>
              {doc.error}
            </Text>
          </View>
        )}
      </View>
    </Card>
  );
}

/** Кружок помощника: градиент его раздела и искра. */
export function AssistantMark({ size = 30 }: { size?: number }) {
  const [a, , c] = heroColors('assistant');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="kbmark" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={a} />
            <Stop offset="1" stopColor={c} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#kbmark)" />
      </Svg>
      <View>
        <Sparkles size={size * 0.52} color="#fff" strokeWidth={2} />
      </View>
    </View>
  );
}

function Cite({ n, source }: { n: number; source: KnowledgeSource | undefined }) {
  const p = usePalette();
  const route = source ? sourceRoute(source) : null;
  return (
    <Text
      accessibilityRole={route ? 'link' : undefined}
      accessibilityLabel={route ? `Источник ${n}: ${source!.title}` : `Источник ${n} недоступен`}
      onPress={route ? () => router.push(route) : undefined}
      style={{ color: route ? p.accent : p.ink3, backgroundColor: route ? p.accentSoft : p.surface2, fontFamily: font.semibold, fontSize: 12 }}
    >
      {` ${n} `}
    </Text>
  );
}

function SourceCard({ s }: { s: KnowledgeSource }) {
  const p = usePalette();
  const route = sourceRoute(s);
  const Icon = s.kind === 'note' ? BookOpen : FileText;
  return (
    <Pressable
      accessibilityRole={route ? 'link' : undefined}
      accessibilityLabel={`${s.n}. ${s.title}`}
      disabled={!route}
      onPress={() => route && router.push(route)}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: p.surface2, opacity: pressed ? 0.8 : 1 })}
    >
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="caption" tone="accent">
          {s.n}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon size={13} color={p.ink3} />
          <Text variant="small" style={{ fontFamily: font.semibold, flex: 1 }} numberOfLines={1}>
            {s.title}
          </Text>
        </View>
        {!!s.excerpt && (
          <Text variant="small" tone="muted" numberOfLines={3}>
            {s.excerpt}
          </Text>
        )}
        {s.goal_title && (
          <Text variant="caption" tone="faint" numberOfLines={1}>
            Цель: {s.goal_title}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/** Ответ помощника: как получен, текст со ссылками [n], источники и оценка. */
export function AnswerView({ message, onFeedback }: { message: KnowledgeMessage; onFeedback?: (f: 'up' | 'down' | null) => void }) {
  const p = usePalette();
  const label = message.mode ? KNOWLEDGE_MODE_LABEL[message.mode] : null;
  const byN = new Map(message.sources.map((s) => [s.n, s]));
  const vote = (f: 'up' | 'down') => onFeedback?.(message.feedback === f ? null : f);
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityRole="header">
        <AssistantMark />
        <View style={{ flex: 1 }}>
          <Text variant="small" style={{ fontFamily: font.semibold }}>
            Помощник
          </Text>
          {label && (
            <Text variant="caption" tone="faint">
              {label}
            </Text>
          )}
        </View>
      </View>
      {message.notice && (
        <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderRadius: radius.sm, backgroundColor: p.warnSoft }}>
          <Info size={15} color={p.warn} style={{ marginTop: 2 }} />
          <Text variant="small" style={{ flex: 1, color: p.warn }}>
            {message.notice}
          </Text>
        </View>
      )}
      <View style={{ gap: 10 }}>
        {answerBlocks(message.content).map((parts, i) => (
          <Text key={i} style={{ lineHeight: 23 }}>
            {parts.map((part, j) => (part.kind === 'text' ? <Fragment key={j}>{part.text}</Fragment> : <Cite key={j} n={part.n} source={byN.get(part.n)} />))}
          </Text>
        ))}
      </View>
      {message.sources.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text variant="eyebrow" tone="faint">
            Источники
          </Text>
          {message.sources.map((s) => (
            <SourceCard key={s.n} s={s} />
          ))}
        </View>
      )}
      {message.mode !== 'empty' && onFeedback && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="caption" tone="faint" style={{ flex: 1 }}>
            Ответ помог?
          </Text>
          {(['up', 'down'] as const).map((f) => {
            const on = message.feedback === f;
            const Icon = f === 'up' ? ThumbsUp : ThumbsDown;
            return (
              <Pressable
                key={f}
                accessibilityRole="button"
                accessibilityLabel={f === 'up' ? 'Полезный ответ' : 'Ответ не помог'}
                accessibilityState={{ selected: on }}
                onPress={() => vote(f)}
                hitSlop={6}
                style={({ pressed }) => ({ width: 38, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? (f === 'up' ? p.goodSoft : p.badSoft) : p.surface2, opacity: pressed ? 0.7 : 1 })}
              >
                <Icon size={16} color={on ? (f === 'up' ? p.good : p.bad) : p.ink3} />
              </Pressable>
            );
          })}
        </View>
      )}
    </Card>
  );
}

/** Вопрос сотрудника — пузырь справа, как в чате. */
export function QuestionBubble({ text }: { text: string }) {
  const p = usePalette();
  return (
    <View accessibilityLabel={`Ваш вопрос: ${text}`} style={{ alignSelf: 'flex-end', maxWidth: '86%', backgroundColor: p.accent, borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10 }}>
      <Text style={{ color: p.accentInk }}>{text}</Text>
    </View>
  );
}

/** Строка «Спросить помощника» на градиенте шапки базы знаний. */
export function AskBar({ onAsk }: { onAsk: (q: string) => void }) {
  const [text, setText] = useState('');
  const send = () => onAsk(text);
  return (
    <Glass radius={22} interactive>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 }}>
        <Sparkles size={17} color="#fff" />
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={send}
          placeholder="Спросите помощника…"
          placeholderTextColor="rgba(255,255,255,0.62)"
          accessibilityLabel="Вопрос помощнику"
          returnKeyType="send"
          maxLength={KNOWLEDGE_LIMITS.question}
          style={[{ flex: 1, minHeight: 40, color: '#fff', fontFamily: font.regular, fontSize: 15.5 }, NO_WEB_OUTLINE]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Спросить помощника"
          onPress={send}
          style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
        >
          <ArrowUp size={18} color="#1d2470" />
        </Pressable>
      </View>
    </Glass>
  );
}
