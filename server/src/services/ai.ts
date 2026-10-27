import { BUILTIN_DIM, BUILTIN_MODEL, builtinEmbedding } from '@offix/core';

/**
 * Нейросеть базы знаний — подключаемая. builtin работает всегда: векторы из
 * слов и цитаты без генерации текста. ollama — локальная модель на своём
 * сервере компании (данные никуда не уходят): векторы и ответ своими словами.
 */
export interface AiProvider {
  /** builtin | ollama */
  readonly name: string;
  /** Чем считаются векторы — хранится рядом с фрагментом; сменили — пересчитываем. */
  readonly embedModel: string;
  /** Модель ответа; null — отвечаем цитатами без генерации. */
  readonly chatModel: string | null;
  embed(texts: string[]): Promise<number[][]>;
  /** Нет — провайдер не пишет текст сам. */
  generate?(prompt: string): Promise<string>;
  /** Отвечает ли нейросеть прямо сейчас. */
  health(): Promise<boolean>;
}

/** Встроенный провайдер: без сети, одинаковый результат на любом сервере — для демо и тестов. */
export function builtinProvider(): AiProvider {
  return {
    name: 'builtin',
    embedModel: BUILTIN_MODEL,
    chatModel: null,
    embed: async (texts) => texts.map((t) => builtinEmbedding(t, BUILTIN_DIM)),
    health: async () => true,
  };
}

/** fetch для нейросети: в тестах — поддельный сервер Ollama. */
export type AiFetch = (
  url: string,
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export interface OllamaOptions {
  url: string;
  embedModel: string;
  chatModel: string;
  fetch?: AiFetch;
  /** Сколько ждать ответа модели; векторы — короче. */
  timeoutMs?: number;
}

export class AiUnavailableError extends Error {
  constructor(message = 'Нейросеть недоступна') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

/**
 * Ollama: `/api/embed` для векторов и `/api/generate` для ответа. Ошибка
 * сети или модели — AiUnavailableError: база знаний перейдёт на встроенный
 * поиск и ответ цитатами, а документы досчитаются позже.
 */
export function ollamaProvider(o: OllamaOptions): AiProvider {
  const base = o.url.replace(/\/+$/, '');
  const f: AiFetch = o.fetch ?? fetch;
  const timeout = o.timeoutMs ?? 120_000;
  const call = async <T>(path: string, body: object, ms: number): Promise<T> => {
    let res: Awaited<ReturnType<AiFetch>>;
    try {
      res = await f(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    } catch {
      throw new AiUnavailableError('Сервер нейросети не отвечает');
    }
    if (!res.ok) throw new AiUnavailableError(`Нейросеть ответила ошибкой ${res.status}`);
    try {
      return (await res.json()) as T;
    } catch {
      throw new AiUnavailableError('Нейросеть вернула непонятный ответ');
    }
  };
  return {
    name: 'ollama',
    embedModel: `ollama:${o.embedModel}`,
    chatModel: o.chatModel,
    async embed(texts) {
      if (!texts.length) return [];
      const out = await call<{ embeddings?: unknown }>('/api/embed', { model: o.embedModel, input: texts }, Math.min(timeout, 60_000));
      const v = out.embeddings;
      if (!Array.isArray(v) || v.length !== texts.length || !v.every((e) => Array.isArray(e) && e.length > 0 && e.every((x) => typeof x === 'number'))) {
        throw new AiUnavailableError('Нейросеть вернула векторы не того вида');
      }
      return v as number[][];
    },
    async generate(prompt) {
      const out = await call<{ response?: unknown }>('/api/generate', { model: o.chatModel, prompt, stream: false, options: { temperature: 0.2 } }, timeout);
      if (typeof out.response !== 'string' || !out.response.trim()) throw new AiUnavailableError('Нейросеть вернула пустой ответ');
      return out.response.trim();
    },
    async health() {
      try {
        const res = await f(`${base}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(3000) });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Провайдер по окружению: KNOWLEDGE_AI=ollama — Ollama по OLLAMA_URL
 * (по умолчанию http://localhost:11434) с моделями OLLAMA_EMBED_MODEL и
 * OLLAMA_CHAT_MODEL; иначе — встроенный.
 */
export function aiProviderFromEnv(env: NodeJS.ProcessEnv = process.env, f?: AiFetch): AiProvider {
  if (env.KNOWLEDGE_AI?.trim().toLowerCase() !== 'ollama') return builtinProvider();
  return ollamaProvider({
    url: env.OLLAMA_URL?.trim() || 'http://localhost:11434',
    embedModel: env.OLLAMA_EMBED_MODEL?.trim() || 'nomic-embed-text',
    chatModel: env.OLLAMA_CHAT_MODEL?.trim() || 'qwen2.5:7b',
    timeoutMs: Number(env.OLLAMA_TIMEOUT_MS) > 0 ? Number(env.OLLAMA_TIMEOUT_MS) : undefined,
    fetch: f,
  });
}
