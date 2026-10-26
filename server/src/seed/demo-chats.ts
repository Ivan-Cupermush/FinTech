import type { Queryable } from '../db/db';

type People = Record<'director' | 'olga' | 'anna' | 'igor' | 'dima' | 'maria' | 'sergey' | 'elena' | 'observer', string>;

export interface DemoChats {
  olga: string;
  igor: string;
  team: string;
  campus: string;
  topics: Record<'general' | 'news' | 'it' | 'analytics', string>;
}

/**
 * Переписка в демо: личные чаты руководителя, рабочая группа по заявкам
 * (с закрепом, реакциями и опросом) и общий чат университета с темами.
 * Время — от «сейчас», чтобы лента всегда выглядела живой.
 */
export async function seedDemoChats(q: Queryable, companyId: string, u: People, now: Date): Promise<DemoChats> {
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  const chat = async (type: 'private' | 'group', name: string | null, by: string, members: string[], opts: { supergroup?: boolean; key?: string; at: string }) => {
    const { rows } = await q.query<{ id: string }>(
      `INSERT INTO chats (company_id, type, name, is_supergroup, created_by, direct_key, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
      [companyId, type, name, !!opts.supergroup, by, opts.key ?? null, opts.at],
    );
    for (const m of members) await q.query(`INSERT INTO chat_members (chat_id, company_id, user_id, joined_at) VALUES ($1, $2, $3, $4)`, [rows[0]!.id, companyId, m, opts.at]);
    return rows[0]!.id;
  };
  const say = async (chatId: string, sender: string, text: string, min: number, extra: { kind?: string; topic?: string; reply?: string; pinned?: boolean; edited?: boolean } = {}) => {
    const { rows } = await q.query<{ id: string; seq: number }>(
      `INSERT INTO messages (chat_id, company_id, topic_id, kind, sender_id, text, reply_to_id, created_at, pinned_at, pinned_by, edited_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, seq`,
      [chatId, companyId, extra.topic ?? null, extra.kind ?? 'text', sender, text, extra.reply ?? null, ago(min), extra.pinned ? ago(min - 1) : null, extra.pinned ? sender : null, extra.edited ? ago(min - 2) : null],
    );
    return rows[0]!;
  };
  const react = (messageId: string, who: string[], emoji: string) =>
    Promise.all(who.map((w) => q.query(`INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`, [messageId, w, emoji])));
  /** Прочитано всё, кроме последних n сообщений. */
  const readAllBut = async (chatId: string, userId: string, keepUnread = 0, topic?: string) => {
    const { rows } = await q.query<{ seq: number }>(`SELECT seq FROM messages WHERE chat_id = $1 AND ($2::uuid IS NULL OR topic_id = $2::uuid) ORDER BY seq DESC`, [chatId, topic ?? null]);
    const seq = rows[keepUnread]?.seq ?? 0;
    if (topic) await q.query(`INSERT INTO topic_reads (topic_id, user_id, last_read_seq) VALUES ($1, $2, $3) ON CONFLICT (topic_id, user_id) DO UPDATE SET last_read_seq = EXCLUDED.last_read_seq`, [topic, userId, seq]);
    else await q.query(`UPDATE chat_members SET last_read_seq = $3 WHERE chat_id = $1 AND user_id = $2`, [chatId, userId, seq]);
  };
  const key = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  // Общий чат университета с темами.
  const all = Object.values(u);
  const campus = await chat('group', 'Университет · общий', u.director, all, { supergroup: true, at: ago(60 * 24 * 30) });
  const topic = async (name: string, icon: string, color: string, general = false) =>
    (await q.query<{ id: string }>(`INSERT INTO topics (chat_id, company_id, name, icon, color, is_general, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [campus, companyId, name, icon, color, general, u.director, ago(60 * 24 * 30)])).rows[0]!.id;
  const topics = {
    general: await topic('Общее', '💬', '#2f4bff', true),
    news: await topic('Объявления', '📣', '#ffb547'),
    it: await topic('IT-поддержка', '🛠️', '#8a72ff'),
    analytics: await topic('Аналитика', '📊', '#2fc6d8'),
  };
  await say(campus, u.director, 'Алексей Петров создаёт группу «Университет · общий»', 60 * 24 * 30, { kind: 'service', topic: topics.general });
  await say(campus, u.elena, 'Коллеги, в пятницу в 16:00 — общее собрание в актовом зале. Повестка: итоги квартала и новые цели.', 60 * 24 * 2, { topic: topics.news, pinned: true });
  await say(campus, u.olga, 'Всем доброе утро! Напоминаю: с понедельника заявки принимаем только через портал.', 60 * 26, { topic: topics.general });
  const it1 = await say(campus, u.anna, 'В 1С не открывается реестр заявок, пишет «нет доступа». У кого-то ещё так?', 60 * 5, { topic: topics.it });
  await say(campus, u.dima, 'Да, после обновления слетели роли. Уже чиним — минут 15.', 60 * 5 - 4, { topic: topics.it, reply: it1.id });
  await say(campus, u.dima, 'Готово, доступ вернули. Перезайдите в 1С.', 60 * 4, { topic: topics.it });
  await say(campus, u.sergey, 'Выгрузил время обработки за неделю: медиана 34 минуты, было 41. Таблица в базе знаний.', 90, { topic: topics.analytics });
  await say(campus, u.maria, 'Отличная динамика 👏', 80, { topic: topics.analytics });
  for (const user of all) {
    await readAllBut(campus, user, 0, topics.general);
    await readAllBut(campus, user, 0, topics.news);
    await readAllBut(campus, user, 0, topics.it);
    await readAllBut(campus, user, 0, topics.analytics);
  }
  await readAllBut(campus, u.director, 2, topics.analytics);
  await readAllBut(campus, u.director, 1, topics.it);

  // Рабочая группа по заявкам.
  const team = await chat('group', 'Заявки за 30 минут', u.olga, [u.olga, u.director, u.anna, u.igor, u.dima, u.maria, u.sergey], { at: ago(60 * 24 * 14) });
  await say(team, u.olga, 'Ольга Смирнова создаёт группу «Заявки за 30 минут»', 60 * 24 * 14, { kind: 'service' });
  const plan = await say(team, u.olga, 'План на неделю: Анна разбирает очередь, Дмитрий — автозаполнение формы, Мария — выборочная проверка 10% заявок.', 60 * 24 * 2, { pinned: true });
  await react(plan.id, [u.director, u.anna, u.maria], '👍');
  await say(team, u.anna, 'Принято. Очередь сейчас 23 заявки, к вечеру разберу.', 60 * 24 * 2 - 10, { reply: plan.id });
  await say(team, u.igor, 'По автозаполнению: интеграция с 1С сдвигается на два дня — ждём доступ к API от подрядчика.', 60 * 24 - 30);
  const igorAsk = await say(team, u.director, 'Игорь, что нужно, чтобы не сдвигать? Могу написать подрядчику сам.', 60 * 24 - 45);
  await say(team, u.igor, 'Было бы здорово. Нужен тестовый стенд к среде.', 60 * 24 - 50, { reply: igorAsk.id });
  const poll = await say(team, u.olga, 'Когда удобнее созвон по итогам недели?', 60 * 3, { kind: 'poll' });
  const pollId = (await q.query<{ id: string }>(`INSERT INTO polls (message_id, question, anonymous, multiple) VALUES ($1, $2, FALSE, FALSE) RETURNING id`, [poll.id, 'Когда удобнее созвон по итогам недели?'])).rows[0]!.id;
  const opt: string[] = [];
  for (const [i, text] of ['Четверг, 11:00', 'Четверг, 16:00', 'Пятница, 10:00'].entries()) opt.push((await q.query<{ id: string }>(`INSERT INTO poll_options (poll_id, position, text) VALUES ($1, $2, $3) RETURNING id`, [pollId, i, text])).rows[0]!.id);
  for (const [who, o] of [[u.anna, 0], [u.maria, 1], [u.sergey, 0], [u.igor, 0]] as const) await q.query(`INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES ($1, $2, $3)`, [pollId, opt[o], who]);
  await say(team, u.maria, 'Проверила 12 заявок из вчерашних: 11 без замечаний, в одной не приложен скан паспорта.', 50);
  const good = await say(team, u.sergey, 'Медиана за неделю — 34 минуты. До цели осталось 4 минуты 🔥', 25);
  await react(good.id, [u.olga, u.anna, u.dima, u.maria], '🔥');
  await react(good.id, [u.igor], '🎉');
  await say(team, u.anna, 'Ура! Ещё немного 💪', 20, { edited: true });
  for (const user of [u.olga, u.anna, u.igor, u.dima, u.maria, u.sergey]) await readAllBut(team, user, 0);
  await readAllBut(team, u.director, 4);

  // Личные чаты руководителя.
  const olga = await chat('private', null, u.olga, [u.olga, u.director], { key: key(u.olga, u.director), at: ago(60 * 24 * 20) });
  await say(olga, u.olga, 'Алексей, добрый день! Подготовила отчёт по заявкам за октябрь, посмотрите, пожалуйста.', 60 * 26);
  await say(olga, u.director, 'Спасибо, посмотрел. Давайте добавим сравнение с сентябрём.', 60 * 25);
  await say(olga, u.olga, 'Добавила. И ещё вопрос: можно ли перевести Анну на гибкий график по пятницам?', 40);
  await say(olga, u.olga, 'Она закрывает очередь раньше всех, думаю, это справедливо.', 39);
  await readAllBut(olga, u.olga, 0);
  await readAllBut(olga, u.director, 2);

  const igor = await chat('private', null, u.director, [u.director, u.igor], { key: key(u.director, u.igor), at: ago(60 * 24 * 10) });
  await say(igor, u.director, 'Написал подрядчику, обещали стенд к среде.', 60 * 20);
  await say(igor, u.igor, 'Отлично, спасибо! Тогда успеваем в срок 👍', 60 * 19);
  await readAllBut(igor, u.director, 0);
  await readAllBut(igor, u.igor, 0);

  await q.query(`UPDATE users SET last_seen_at = $2 WHERE id = ANY($1::uuid[])`, [all, ago(12)]);
  await q.query(`UPDATE users SET last_seen_at = $2 WHERE id = $1`, [u.igor, ago(60 * 3)]);
  return { olga, igor, team, campus, topics };
}
