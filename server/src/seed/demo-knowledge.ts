import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import PDFDocument from 'pdfkit';
import type { Db } from '../db/db';
import type { KnowledgeService } from '../services/knowledge';
import type { MediaStore } from '../services/media';
import { fontsDir } from '../services/note-pdf';
import type { DemoIds } from './demo';

/** DOCX из абзацев: zip с word/document.xml — так его сохраняет Word. */
export function demoDocx(paragraphs: string[]): Buffer {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return Buffer.from(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(xml) }));
}

/** PDF-документ компании: заголовок и абзацы шрифтом Onest (встроенные шрифты PDF не знают кириллицы). */
function policyPdf(title: string, blocks: { h?: string; p?: string; li?: string[] }[]): Promise<Buffer> {
  const fonts = fontsDir();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 64, right: 64 }, info: { Title: title, Creator: 'offix demo' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('regular', join(fonts, 'Onest_400Regular.ttf'));
    doc.registerFont('bold', join(fonts, 'Onest_600SemiBold.ttf'));
    const width = doc.page.width - 128;
    doc.font('bold').fontSize(20).fillColor('#141625').text(title, { width });
    doc.moveDown(0.8);
    for (const b of blocks) {
      if (b.h) doc.font('bold').fontSize(13).fillColor('#141625').text(b.h, { width }).moveDown(0.3);
      if (b.p) doc.font('regular').fontSize(11).fillColor('#2b2e45').text(b.p, { width, lineGap: 2 }).moveDown(0.6);
      for (const li of b.li ?? []) doc.font('regular').fontSize(11).fillColor('#2b2e45').text(`•  ${li}`, { width, indent: 4, lineGap: 2 }).moveDown(0.2);
      if (b.li) doc.moveDown(0.4);
    }
    doc.end();
  });
}

/** «Скан» без текстового слоя: одна серая плашка — такой PDF помощник прочитать не сможет. */
function scanLikePdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.rect(60, 60, 475, 700).fill('#d9d9d4');
    doc.end();
  });
}

const REGULATION = [
  'Регламент рассмотрения заявлений студентов',
  '1. Общие положения',
  'Регламент описывает, как учебный офис принимает, регистрирует и рассматривает заявления студентов: справки, перезачёт дисциплин, академический отпуск, перевод на индивидуальный график.',
  'Заявление регистрируется в СЭД в день поступления. Номер регистрации сообщается студенту автоматически.',
  '2. Сроки',
  'Типовую заявку (справка об обучении, копия приказа) учебный офис закрывает за два рабочих дня.',
  'Нетиповую заявку (перезачёт, индивидуальный график) рассматривают до пяти рабочих дней: нужна проверка методиста и согласование с кафедрой.',
  'Время обработки считается от регистрации в СЭД до отправки ответа студенту.',
  '3. Если заявка зависла',
  'Если заявка зависла на проверке дольше одного рабочего дня, специалист отмечает блокер в задаче offix и пишет руководителю учебного офиса.',
  'Руководитель учебного офиса в течение дня решает: перераспределить заявку, ускорить проверку или предупредить студента о новом сроке.',
  '4. Изменение показателей',
  'Изменение KPI цели (целевого значения или способа замера) согласует владелец цели с проректором по цифровой трансформации. Изменения фиксируются в карточке цели.',
];

const PRIVACY: { h?: string; p?: string; li?: string[] }[] = [
  { h: 'Что защищаем', p: 'Персональные данные студентов: ФИО, паспорт, СНИЛС, оценки, сведения о здоровье и об оплате обучения.' },
  {
    h: 'Правила',
    li: [
      'Доступ к данным — только у сотрудников, которым он нужен по работе.',
      'Документы со сведениями о студентах не пересылаются через личные мессенджеры и почту — только через СЭД и рабочие чаты offix.',
      'Распечатки с персональными данными не оставляют на столах и уничтожают в шредере.',
    ],
  },
  { h: 'Если произошла утечка', p: 'Сотрудник сообщает в отдел информационной безопасности в течение 24 часов: что случилось, какие данные затронуты, кто узнал.' },
];

const MENTOR = [
  'Памятка наставнику нового сотрудника учебного офиса',
  '',
  'Первый день. Наставник встречает новичка, проводит экскурсию, выдаёт доступы к СЭД и offix и знакомит с командой.',
  '',
  'Первая неделя. Новичок разбирает типовые заявки вместе с наставником. Наставник проверяет каждый ответ студенту до отправки.',
  '',
  'Тридцатый день. Наставник и руководитель проводят встречу по итогам испытательного срока: что получается, где нужна помощь, какие заявки новичок берёт самостоятельно.',
].join('\n');

/**
 * База знаний в демо: регламент (DOCX), положение о персональных данных
 * (PDF с кириллицей), памятка наставнику к цели адаптации (TXT) и «скан»
 * без текста — чтобы было видно, как помощник честно говорит, что не смог
 * прочитать файл. Документы обрабатываются сразу, статьи индексируются.
 */
export async function seedDemoKnowledge(db: Db, store: MediaStore, kb: KnowledgeService, demo: DemoIds, now = new Date()): Promise<string[]> {
  const u = demo.users;
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const files: { title: string; name: string; mime: string; type: 'pdf' | 'docx' | 'text'; data: Buffer; by: string; goal: string | null; days: number }[] = [
    {
      title: 'Регламент рассмотрения заявлений студентов',
      name: 'Регламент_заявлений_2026.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      type: 'docx',
      data: demoDocx(REGULATION),
      by: u.olga,
      goal: null,
      days: 12,
    },
    {
      title: 'Положение о защите персональных данных студентов',
      name: 'Положение_ПДн.pdf',
      mime: 'application/pdf',
      type: 'pdf',
      data: await policyPdf('Положение о защите персональных данных студентов', PRIVACY),
      by: u.director,
      goal: null,
      days: 30,
    },
    { title: 'Памятка наставнику', name: 'Памятка наставнику.txt', mime: 'text/plain', type: 'text', data: Buffer.from(MENTOR), by: u.elena, goal: demo.goals.onboarding ?? null, days: 5 },
    { title: 'Скан приказа № 214', name: 'Скан приказа 214.pdf', mime: 'application/pdf', type: 'pdf', data: await scanLikePdf(), by: u.olga, goal: null, days: 2 },
  ];

  const ids: string[] = [];
  for (const f of files) {
    const tmp = join(store.tmpDir, `${randomBytes(8).toString('hex')}-${f.name}`);
    await fs.writeFile(tmp, f.data);
    try {
      const p = await store.process({ path: tmp, originalName: f.name, mime: f.mime, size: f.data.length, asFile: true });
      const id = await db.tx(async (q) => {
        const { rows } = await q.query<{ id: string }>(`INSERT INTO knowledge_docs (company_id, goal_id, title, doc_type, uploaded_by, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [
          demo.companyId,
          f.goal,
          f.title,
          f.type,
          f.by,
          ago(f.days),
        ]);
        await q.query(
          `INSERT INTO attachments (company_id, uploaded_by, owner_type, owner_id, position, kind, name, mime, size, storage_key, thumb_key, created_at)
           VALUES ($1, $2, 'kb_doc', $3, 0, $4, $5, $6, $7, $8, $9, $10)`,
          [demo.companyId, f.by, rows[0]!.id, p.kind, p.name, p.mime, p.size, p.storage_key, p.thumb_key, ago(f.days)],
        );
        return rows[0]!.id;
      });
      ids.push(id);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  // Статья к подсказке помощника «Кто согласует изменение KPI цели?».
  await db.query(`INSERT INTO notes (company_id, goal_id, title, body, created_by, created_at, updated_at) VALUES ($1, NULL, $2, $3, $4, $5, $5)`, [
    demo.companyId,
    'Как меняем KPI цели',
    [
      'Целевое значение и способ замера KPI меняет только **владелец цели** после согласования с проректором.',
      '',
      '- предложение — в обсуждении цели, с причиной и новыми цифрами',
      '- после согласования владелец правит KPI в карточке цели',
      '- старые замеры не удаляем: по ним видно, откуда начинали',
    ].join('\n'),
    u.director,
    ago(3),
  ]);

  for (const id of ids) await kb.processDoc(id);
  await kb.syncNotes(demo.companyId, 500);
  return ids;
}
