import { addDays, todayIso } from '@offix/core';
import type { Db } from '../db/db';
import { notify } from '../services/notify';
import type { DemoIds } from './demo';

/**
 * Личное пространство в демо: ежедневник директора на этот месяц, заметка
 * Ольги в рабочей группе, запрос свежей версии (ждёт ответа директора)
 * и свои имена для коллег. Отдельно от seedDemo — тестам нужна пустая база заметок.
 */
export async function seedDemoPersonal(db: Db, demo: DemoIds, now = new Date()): Promise<void> {
  const u = demo.users;
  const c = demo.chats;
  const today = todayIso(now);
  const day = (n: number) => addDays(today, n);
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

  await db.tx(async (q) => {
    const note = async (owner: string, title: string, body: string, date: string, favorite = false, updatedMin = 60) => {
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO personal_notes (company_id, owner_id, title, body, note_date, is_favorite, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
        [demo.companyId, owner, title, body, date, favorite, ago(updatedMin)],
      );
      return rows[0]!.id;
    };

    await note(
      u.director,
      'План на неделю',
      '## Главное\n\n- [x] Созвон с подрядчиком 1С — стенд к среде\n- [ ] Посмотреть медиану обработки заявок в пятницу\n- [ ] Обсудить с Марией выборочную проверку\n\n**Цель недели:** 32 минуты вместо 34.',
      today,
      true,
      40,
    );
    await note(u.director, 'Вопросы к созвону с QA', '- сколько заявок возвращаем на доработку\n- где чаще всего не хватает скана\n- нужен ли второй проверяющий', day(1), false, 90);
    await note(u.director, 'После встречи с ректоратом', 'Ректорат просит показывать эффект в деньгах: часы сотрудников × ставка. Подготовить слайд к отчёту за месяц.', day(-1), false, 60 * 20);
    await note(u.director, 'Черновик письма в IT', 'Игорь, добрый день! Чтобы не сдвигать автозаполнение, предлагаю…\n\n_дописать после созвона_', day(-3), false, 60 * 70);
    const ideas = await note(u.director, 'Идеи для отчёта', '1. Время обработки до и после\n2. Сколько заявок без возвратов\n3. Что мешало: доступы, справочники, сканы', day(-8), true, 60 * 24 * 8);
    await note(u.director, 'Книги и статьи', '- «Цель» Голдратта — про узкие места\n- статья про медиану против среднего', day(-12), false, 60 * 24 * 12);

    const regl = await note(u.olga, 'Регламент приёма заявок — черновик', '## Порядок\n\n1. Заявка приходит через портал\n2. Анна проверяет комплект документов\n3. Мария выборочно проверяет 10%\n\nСрок ответа студенту — **30 минут**.', day(-1), true, 60 * 6);

    // Снимок в чат: так же, как POST /my-notes/:id/share.
    const share = async (noteId: string, sender: string, chatId: string, caption: string, min: number) => {
      const n = (await q.query<{ title: string; body: string }>(`SELECT title, body FROM personal_notes WHERE id = $1`, [noteId])).rows[0]!;
      const { rows } = await q.query<{ id: string }>(`INSERT INTO note_shares (company_id, note_id, sender_id, title, body, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [
        demo.companyId,
        noteId,
        sender,
        n.title,
        n.body,
        ago(min),
      ]);
      await q.query(`INSERT INTO messages (chat_id, company_id, kind, sender_id, text, note_share_id, created_at) VALUES ($1, $2, 'note', $3, $4, $5, $6)`, [chatId, demo.companyId, sender, caption, rows[0]!.id, ago(min)]);
      await q.query(`UPDATE chats SET updated_at = GREATEST(updated_at, $2) WHERE id = $1`, [chatId, ago(min)]);
      return rows[0]!.id;
    };
    // Лента идёт по seq, то есть по порядку вставки, а демо-файлы уже заняли
    // последние минуты: наши сообщения — самые свежие, старое вставляем первым.
    const ideasShare = await share(ideas, u.director, c.team, 'Мои идеи для отчёта за месяц', 5);
    await share(regl, u.olga, c.team, 'Черновик регламента — посмотрите до пятницы', 2);

    // Ольга просит у директора свежую версию идей — запрос ждёт ответа во «Входящих».
    const { rows: req } = await q.query<{ id: string }>(
      `INSERT INTO note_share_requests (company_id, share_id, requester_id, owner_id, note_id, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [demo.companyId, ideasShare, u.olga, u.director, ideas, ago(3)],
    );
    await notify(q, { company_id: demo.companyId, user_id: u.director, kind: 'note_request', title: 'Ольга Смирнова просит свежую версию заметки', body: 'Идеи для отчёта', data: { request_id: req[0]!.id, share_id: ideasShare } }, u.olga);
    await q.query(`UPDATE notifications SET created_at = $2 WHERE data->>'request_id' = $1`, [req[0]!.id, ago(3)]);

    // Свои имена для коллег — видит только тот, кто их дал.
    const names: [string, string, string][] = [
      [u.director, u.igor, 'Игорь · IT'],
      [u.director, u.maria, 'Мария (качество)'],
      [u.anna, u.olga, 'Ольга Викторовна'],
    ];
    for (const [owner, user, name] of names) await q.query(`INSERT INTO contact_names (company_id, owner_id, user_id, name) VALUES ($1, $2, $3, $4)`, [demo.companyId, owner, user, name]);
  });
}
