import { FilePlus2, ImagePlus, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ALBUM_MAX, MESSAGE_MAX, detectFileKind, formatBytes, isBlockedFile, type Attachment } from '@offix/core';
import { ApiError } from '../../lib/api';
import { dropDraft, uploadFile } from '../../lib/files';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Misc';
import { FileIcon } from './media';

interface Item {
  key: string;
  file: File;
  kind: 'photo' | 'video' | 'file';
  progress: number;
  att: Attachment | null;
  error: string | null;
  ctrl: AbortController | null;
}

let seq = 0;
const PARALLEL = 3;

function makeItem(file: File): Item {
  const kind = detectFileKind({ name: file.name, mime: file.type });
  const blocked = isBlockedFile(file.name, file.type);
  return {
    key: `f${++seq}`,
    file,
    kind,
    progress: 0,
    att: null,
    error: blocked ? 'Такой тип файла отправить нельзя' : null,
    ctrl: null,
  };
}

/** Превью выбранного файла: адрес blob живёт, пока плитка на экране. */
function Preview({ file, kind }: { file: File; kind: Item['kind'] }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (kind === 'file' || typeof URL.createObjectURL !== 'function') return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, kind]);
  if (!url) return <FileIcon name={file.name} />;
  return kind === 'video' ? <video className="attach-thumb" src={url} muted playsInline preload="metadata" /> : <img className="attach-thumb" src={url} alt="" />;
}

const errText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не удалось загрузить');
const plural = (n: number, one: string, few: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);

/**
 * Отправка файлов: загрузка начинается сразу, пока пишется подпись. Фото и
 * видео уходят альбомом (до десяти в сообщении), «как файлы» — без сжатия.
 * Отменённое удаляется с сервера сразу, остальное подчистит уборка черновиков.
 */
export function AttachDialog({
  files,
  asFile: asFileInitial,
  caption: initialCaption = '',
  onClose,
  onSend,
}: {
  files: File[];
  asFile: boolean;
  caption?: string;
  onClose: () => void;
  onSend: (batches: { attachments: Attachment[]; text: string }[]) => void;
}) {
  const [items, setItems] = useState<Item[]>(() => files.map(makeItem));
  const [asFile, setAsFile] = useState(asFileInitial);
  const [caption, setCaption] = useState(initialCaption);
  const live = useRef(items);
  live.current = items;
  const more = useRef<HTMLInputElement>(null);
  const sent = useRef(false);
  const started = useRef(new Set<string>());
  const mounted = useRef(true);

  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((x) => (x.key === key ? { ...x, ...p } : x)));

  // Очередь загрузок: не больше трёх сразу; каждую — один раз.
  useEffect(() => {
    const busy = items.filter((x) => started.current.has(x.key) && !x.att && !x.error).length;
    const next = items.filter((x) => !started.current.has(x.key) && !x.att && !x.error).slice(0, Math.max(0, PARALLEL - busy));
    for (const it of next) {
      started.current.add(it.key);
      const ctrl = new AbortController();
      patch(it.key, { ctrl, progress: 0 });
      uploadFile(it.file, { fields: { as_file: asFile && it.kind !== 'file' ? 1 : undefined }, onProgress: (p) => patch(it.key, { progress: p }), signal: ctrl.signal })
        .then((att) => {
          if (ctrl.signal.aborted) return void dropDraft(att.id);
          patch(it.key, { att, progress: 1 });
        })
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') patch(it.key, { error: errText(e), ctrl: null });
        });
    }
  }, [items, asFile]);

  // Закрыли без отправки — загрузки прерываем, готовые черновики удаляем.
  // Проверка через тик: в режиме разработки React «перемонтирует» окно сразу после открытия.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (mounted.current || sent.current) return;
        for (const x of live.current) {
          x.ctrl?.abort();
          if (x.att) void dropDraft(x.att.id);
        }
      }, 0);
    };
  }, []);

  const toggleAsFile = (v: boolean) => {
    setAsFile(v);
    // Фото и видео обрабатываются по-разному: перезагружаем их заново.
    setItems((list) =>
      list.map((x) => {
        if (x.kind === 'file' || (x.error && !x.att && !x.ctrl)) return x;
        x.ctrl?.abort();
        if (x.att) void dropDraft(x.att.id);
        // Новый ключ — загрузка начнётся заново.
        return { ...x, key: `f${++seq}`, att: null, ctrl: null, progress: 0, error: null };
      }),
    );
  };

  const remove = (key: string) => {
    const x = items.find((i) => i.key === key);
    if (!x) return;
    x.ctrl?.abort();
    if (x.att) void dropDraft(x.att.id);
    setItems((list) => list.filter((i) => i.key !== key));
  };

  const add = (list: FileList | null) => {
    if (list?.length) setItems((cur) => [...cur, ...Array.from(list).map(makeItem)]);
  };

  const ok = items.filter((x) => !x.error);
  const done = ok.length > 0 && ok.every((x) => x.att);
  const total = ok.reduce((s, x) => s + x.file.size, 0) || 1;
  const progress = ok.reduce((s, x) => s + x.file.size * (x.att ? 1 : x.progress), 0) / total;
  const visual = items.some((x) => x.kind !== 'file');
  const tooLong = caption.trim().length > MESSAGE_MAX;
  const title = !items.length ? 'Нечего отправлять' : asFile || !visual ? `${items.length} ${plural(items.length, 'файл', 'файла', 'файлов')}` : `${items.length} ${plural(items.length, 'медиафайл', 'медиафайла', 'медиафайлов')}`;

  const send = () => {
    if (!done || tooLong) return;
    sent.current = true;
    const atts = ok.map((x) => x.att!);
    const batches: { attachments: Attachment[]; text: string }[] = [];
    for (let i = 0; i < atts.length; i += ALBUM_MAX) batches.push({ attachments: atts.slice(i, i + ALBUM_MAX), text: '' });
    // Подпись — к последней пачке: она окажется под альбомом, внизу ленты.
    batches[batches.length - 1]!.text = caption.trim();
    onSend(batches);
    onClose();
  };

  return (
    <Dialog
      title={`Отправить ${title}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" icon={asFile ? <FilePlus2 size={16} /> : <ImagePlus size={16} />} onClick={() => more.current?.click()}>
            Добавить
          </Button>
          <span className="grow" />
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={send} disabled={!done || tooLong} aria-busy={!done || undefined}>
            {done ? 'Отправить' : `Загрузка ${Math.round(progress * 100)}%`}
          </Button>
        </>
      }
    >
      <div className={`attach ${asFile || !visual ? 'is-files' : 'is-media'}`}>
        <div className="attach-grid" role="list" aria-label="Файлы к отправке">
          {items.map((x) => (
            <div key={x.key} role="listitem" className={`attach-item ${x.error ? 'is-error' : ''} ${x.att ? 'is-done' : ''}`} style={{ '--p': x.att ? 1 : x.progress } as CSSProperties}>
              {asFile ? <FileIcon name={x.file.name} /> : <Preview file={x.file} kind={x.kind} />}
              <span className="attach-text">
                <span className="clip attach-name">{x.file.name}</span>
                <span className={x.error ? 'attach-err' : 'faint'}>{x.error ?? (x.att ? formatBytes(x.att.size) : `${formatBytes(x.file.size)} · ${Math.round(x.progress * 100)}%`)}</span>
              </span>
              {!x.att && !x.error && <span className="attach-ring" aria-hidden />}
              <button type="button" className="attach-remove" onClick={() => remove(x.key)} aria-label={`Убрать ${x.file.name}`}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        {visual && (
          <label className="attach-asfile">
            <input type="checkbox" checked={asFile} onChange={(e) => toggleAsFile(e.target.checked)} />
            <span>
              Отправить как файл <span className="faint">— без сжатия, в исходном качестве</span>
            </span>
          </label>
        )}
        <textarea
          className="input attach-caption"
          rows={2}
          value={caption}
          placeholder="Подпись"
          aria-label="Подпись"
          aria-invalid={tooLong}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          autoFocus
        />
        {items.length > ALBUM_MAX && <p className="faint attach-note">В одном сообщении — до {ALBUM_MAX} файлов: остальные уйдут следующими сообщениями.</p>}
      </div>
      <input ref={more} type="file" multiple hidden accept={asFile ? undefined : 'image/*,video/*'} aria-label="Добавить файлы" onChange={(e) => (add(e.target.files), (e.target.value = ''))} />
    </Dialog>
  );
}
