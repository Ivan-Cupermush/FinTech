import {
  addDays,
  answerParts,
  formatBytes,
  formatDate,
  KNOWLEDGE_LIMITS,
  knowledgeDocType,
  plural,
  titleFromFileName,
  type AnswerPart,
  type KnowledgeDoc,
  type KnowledgeSession,
  type KnowledgeSource,
  type NoteSummary,
} from '@offix/core';
import type { HeroStat } from './fx';

/**
 * Помощник базы знаний на телефоне: спросить, перечитать ответ со ссылками,
 * открыть документ. Чистая логика — без React Native, чтобы проверять тестами.
 */

/** Куда ведёт источник ответа: статья — на статью, документ — на его экран. Недоступный — никуда. */
export function sourceRoute(s: Pick<KnowledgeSource, 'kind' | 'id'>): string | null {
  if (!s.id) return null;
  return s.kind === 'note' ? `/notes/${s.id}` : `/notes/doc/${s.id}`;
}

/** Экран помощника: с вопросом из строки поиска — он задаётся сразу. */
export function askRoute(question?: string): string {
  const q = question?.trim();
  return q ? `/notes/ask?q=${encodeURIComponent(q)}` : '/notes/ask';
}

/** Ответ по абзацам; ссылки [n] внутри абзаца — отдельные кусочки, их рисуем кнопками. */
export function answerBlocks(content: string): AnswerPart[][] {
  return content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => answerParts(p));
}

/** Цифры шапки базы знаний — те же, что на сайте: статьи, документы, обновлено за неделю. */
export function knowledgeStats(notes: Pick<NoteSummary, 'updated_at'>[], readyDocs: number | undefined, today: string): HeroStat[] {
  const weekAgo = addDays(today, -7);
  return [
    { label: plural(notes.length, ['статья', 'статьи', 'статей']), value: notes.length },
    ...(readyDocs === undefined ? [] : [{ label: plural(readyDocs, ['документ', 'документа', 'документов']), value: readyDocs }]),
    { label: 'за неделю', value: notes.filter((n) => n.updated_at.slice(0, 10) >= weekAgo).length },
  ];
}

/** Можно ли отдать файл помощнику: тип и размер проверяем до загрузки, чтобы не ждать отказа сервера. */
export function pickedDocError(f: { name: string; mime: string; size: number | null }): string | null {
  if (!knowledgeDocType(f.name, f.mime)) return 'Загрузите PDF, DOCX, TXT или MD';
  if (f.size !== null && f.size > KNOWLEDGE_LIMITS.docBytes) return `Файл больше ${formatBytes(KNOWLEDGE_LIMITS.docBytes)}`;
  return null;
}

/** Поля формы загрузки: название из имени файла и цель, если загружаем к цели. Поля — до файла. */
export function docUploadFields(name: string, goalId?: string | null): [string, string][] {
  const fields: [string, string][] = [['title', titleFromFileName(name)]];
  if (goalId) fields.push(['goal_id', goalId]);
  return fields;
}

/** Подпись под вопросом в истории: сколько вопросов и когда. */
export function sessionMeta(s: Pick<KnowledgeSession, 'questions' | 'updated_at'>, today: string): string {
  return `${s.questions} ${plural(s.questions, ['вопрос', 'вопроса', 'вопросов'])} · ${formatDate(s.updated_at.slice(0, 10), { short: true, today })}`;
}

/** Строка документов на экране цели. */
export function docsLine(docs: Pick<KnowledgeDoc, 'status'>[] | undefined): string {
  if (!docs) return 'Регламенты и файлы, по которым отвечает помощник';
  if (!docs.length) return 'Пока нет — загружаются на сайте или здесь';
  const ready = docs.filter((d) => d.status === 'ready').length;
  const head = `${docs.length} ${plural(docs.length, ['документ', 'документа', 'документов'])}`;
  return ready === docs.length ? head : `${head}, готово ${ready}`;
}
