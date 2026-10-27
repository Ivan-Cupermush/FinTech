import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_LIMITS } from '@offix/core';
import { heroColors, SECTION_VARIANTS } from '../src/lib/fx';
import { answerBlocks, askRoute, docsLine, docUploadFields, knowledgeStats, pickedDocError, sessionMeta, sourceRoute } from '../src/lib/knowledge';

const TODAY = '2026-10-21';

describe('куда ведут источники ответа', () => {
  it('статья — на статью, документ — на экран документа', () => {
    expect(sourceRoute({ kind: 'note', id: 'n1' })).toBe('/notes/n1');
    expect(sourceRoute({ kind: 'doc', id: 'd1' })).toBe('/notes/doc/d1');
  });
  it('источник, к которому больше нет доступа, никуда не ведёт', () => {
    expect(sourceRoute({ kind: 'doc', id: '' })).toBeNull();
  });
});

describe('askRoute', () => {
  it('вопрос из строки поиска уходит параметром и задаётся сразу', () => {
    expect(askRoute('Кто согласует KPI?')).toBe('/notes/ask?q=%D0%9A%D1%82%D0%BE%20%D1%81%D0%BE%D0%B3%D0%BB%D0%B0%D1%81%D1%83%D0%B5%D1%82%20KPI%3F');
  });
  it('пустая строка — просто экран помощника', () => {
    expect(askRoute('   ')).toBe('/notes/ask');
    expect(askRoute()).toBe('/notes/ask');
  });
});

describe('answerBlocks', () => {
  it('абзацы, а ссылки [n] — отдельными кусочками', () => {
    const b = answerBlocks('Типовую заявку закрывают за два дня [1].\n\nЕсли зависла — пишут руководителю [1, 2].');
    expect(b).toHaveLength(2);
    expect(b[0]).toEqual([
      { kind: 'text', text: 'Типовую заявку закрывают за два дня ' },
      { kind: 'cite', n: 1 },
      { kind: 'text', text: '.' },
    ]);
    expect(b[1]!.filter((x) => x.kind === 'cite')).toEqual([
      { kind: 'cite', n: 1 },
      { kind: 'cite', n: 2 },
    ]);
  });
  it('пустые абзацы пропускаем', () => {
    expect(answerBlocks('\n\n  \n\nОдин абзац\n\n')).toEqual([[{ kind: 'text', text: 'Один абзац' }]]);
  });
});

describe('knowledgeStats', () => {
  const notes = [{ updated_at: '2026-10-20T10:00:00Z' }, { updated_at: '2026-10-14T10:00:00Z' }, { updated_at: '2026-09-01T10:00:00Z' }];
  it('статьи, готовые документы и обновлённое за неделю — как на сайте', () => {
    const s = knowledgeStats(notes, 3, TODAY);
    expect(s.map((x) => x.label)).toEqual(['статей', 'документов', 'за неделю']);
    expect(s.map((x) => x.value)).toEqual([3, 3, 2]);
  });
  it('пока документы не загрузились, плитки документов нет', () => {
    expect(knowledgeStats(notes, undefined, TODAY).map((x) => x.label)).toEqual(['статей', 'за неделю']);
  });
});

describe('pickedDocError', () => {
  it('PDF, DOCX, TXT и MD подходят', () => {
    expect(pickedDocError({ name: 'Регламент.pdf', mime: 'application/pdf', size: 1000 })).toBeNull();
    expect(pickedDocError({ name: 'Положение.docx', mime: '', size: 1000 })).toBeNull();
    expect(pickedDocError({ name: 'заметка.md', mime: 'text/markdown', size: null })).toBeNull();
  });
  it('картинку и таблицу не берём', () => {
    expect(pickedDocError({ name: 'фото.jpg', mime: 'image/jpeg', size: 1000 })).toBe('Загрузите PDF, DOCX, TXT или MD');
    expect(pickedDocError({ name: 'план.xlsx', mime: '', size: 1000 })).toBe('Загрузите PDF, DOCX, TXT или MD');
  });
  it('слишком большой файл отсекаем до загрузки', () => {
    expect(pickedDocError({ name: 'большой.pdf', mime: 'application/pdf', size: KNOWLEDGE_LIMITS.docBytes + 1 })).toMatch(/^Файл больше 20/);
    expect(pickedDocError({ name: 'ровно.pdf', mime: 'application/pdf', size: KNOWLEDGE_LIMITS.docBytes })).toBeNull();
  });
});

describe('docUploadFields', () => {
  it('название — из имени файла, цель — если загружаем к цели', () => {
    expect(docUploadFields('Регламент_заявлений_2026.docx')).toEqual([['title', 'Регламент заявлений 2026']]);
    expect(docUploadFields('Памятка.txt', 'g1')).toEqual([
      ['title', 'Памятка'],
      ['goal_id', 'g1'],
    ]);
  });
});

describe('sessionMeta и docsLine', () => {
  it('сколько вопросов и когда', () => {
    expect(sessionMeta({ questions: 1, updated_at: '2026-10-21T08:00:00Z' }, TODAY)).toMatch(/^1 вопрос · /);
    expect(sessionMeta({ questions: 3, updated_at: '2026-10-20T08:00:00Z' }, TODAY)).toMatch(/^3 вопроса · /);
    expect(sessionMeta({ questions: 5, updated_at: '2026-10-20T08:00:00Z' }, TODAY)).toMatch(/^5 вопросов · /);
  });
  it('строка документов на экране цели', () => {
    expect(docsLine(undefined)).toMatch(/помощник/);
    expect(docsLine([])).toMatch(/^Пока нет/);
    expect(docsLine([{ status: 'ready' }, { status: 'ready' }])).toBe('2 документа');
    expect(docsLine([{ status: 'ready' }, { status: 'processing' }, { status: 'failed' }, { status: 'ready' }, { status: 'ready' }])).toBe('5 документов, готово 3');
  });
});

describe('шапка помощника', () => {
  it('у помощника своя палитра, отличная от базы знаний', () => {
    expect(SECTION_VARIANTS).toContain('assistant');
    expect(heroColors('assistant').join()).not.toBe(heroColors('knowledge').join());
  });
});
