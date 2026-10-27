import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Download, FileText, Pencil, RefreshCw, Target, Trash2, UploadCloud } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { KNOWLEDGE_LIMITS, KNOWLEDGE_STATUS_LABEL, formatBytes, formatDate, knowledgeDocBusy, knowledgeDocFacts, knowledgeDocType, knowledgeDocTypeLabel, todayIso, validateKnowledgeTitle, type KnowledgeDoc } from '@offix/core';
import { api, ApiError } from '../../lib/api';
import { openFile, uploadKnowledgeDoc } from '../../lib/files';
import { PageHero } from '../../ui/fx/PageHero';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog, Empty, Skeleton } from '../../ui/Misc';
import { Pill, type Tone } from '../../ui/Pill';
import { useToast } from '../../ui/Toast';
import { useKnowledgeDoc, useKnowledgeDocs } from './data';
import './knowledge.css';

const STATUS_TONE: Record<KnowledgeDoc['status'], Tone> = { pending: 'info', processing: 'accent', ready: 'good', failed: 'bad' };

export const DocStatus = ({ doc }: { doc: Pick<KnowledgeDoc, 'status'> }) => (
  <Pill tone={STATUS_TONE[doc.status]} live={knowledgeDocBusy(doc)}>
    {KNOWLEDGE_STATUS_LABEL[doc.status]}
  </Pill>
);

/** «12 стр. · 48 фрагментов · 2,1 МБ» — что известно о документе. */
function useDocActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['kb-docs'] }), qc.invalidateQueries({ queryKey: ['kb-doc'] }), qc.invalidateQueries({ queryKey: ['kb-status'] })]);
  const reprocess = useMutation({
    mutationFn: (id: string) => api<KnowledgeDoc>(`/knowledge/docs/${id}/reprocess`, { method: 'POST' }),
    onSuccess: async () => {
      await refresh();
      toast('Документ снова в очереди');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/knowledge/docs/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await refresh();
      toast('Документ удалён');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  return { reprocess, remove, refresh };
}

function ConfirmDelete({ doc, onClose, onDone }: { doc: KnowledgeDoc; onClose: () => void; onDone?: () => void }) {
  const { remove } = useDocActions();
  return (
    <Dialog
      title="Удалить документ?"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Оставить
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(doc.id, { onSuccess: () => (onClose(), onDone?.()) })}>
            Удалить
          </Button>
        </>
      }
    >
      <p className="muted">«{doc.title}» исчезнет из базы знаний: помощник перестанет на него ссылаться, а файл удалится.</p>
    </Dialog>
  );
}

interface Uploading {
  key: string;
  name: string;
  progress: number;
}

/**
 * Документы базы знаний: загрузка перетаскиванием или кнопкой, статус
 * чтения, причина ошибки и повтор. Для цели — документы этой цели.
 */
export function DocsPanel({ goalId, canUpload }: { goalId?: string; canUpload: boolean }) {
  const docs = useKnowledgeDocs(goalId);
  const { reprocess, refresh } = useDocActions();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const [drag, setDrag] = useState(false);
  const [confirm, setConfirm] = useState<KnowledgeDoc | null>(null);
  const today = todayIso();

  const start = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!knowledgeDocType(file.name, file.type)) {
        toast(`«${file.name}»: загрузите PDF, DOCX, TXT или MD`, 'error');
        continue;
      }
      if (file.size > KNOWLEDGE_LIMITS.docBytes) {
        toast(`«${file.name}» больше ${formatBytes(KNOWLEDGE_LIMITS.docBytes)}`, 'error');
        continue;
      }
      const key = `${file.name}-${file.size}-${Date.now()}`;
      setUploading((u) => [...u, { key, name: file.name, progress: 0 }]);
      uploadKnowledgeDoc(file, { fields: { goal_id: goalId }, onProgress: (p) => setUploading((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))) })
        .then(async () => {
          await refresh();
          toast(`«${file.name}» загружен — помощник прочитает его через минуту`);
        })
        .catch((e: unknown) => toast(e instanceof ApiError ? Object.values(e.fields)[0] ?? e.message : (e as Error).message, 'error'))
        .finally(() => setUploading((u) => u.filter((x) => x.key !== key)));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (canUpload && e.dataTransfer.files.length) start(e.dataTransfer.files);
  };

  return (
    <section className="stack" style={{ '--gap': '14px' } as React.CSSProperties} aria-label="Документы базы знаний">
      {canUpload && (
        <div
          className={`kb-drop ${drag ? 'is-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        >
          <span className="kb-drop-icon" aria-hidden>
            <UploadCloud size={22} />
          </span>
          <div className="kb-drop-text">
            <b>Перетащите регламенты, инструкции и договоры</b>
            <span className="faint">PDF, DOCX, TXT или MD до {formatBytes(KNOWLEDGE_LIMITS.docBytes)}. Помощник прочитает их и будет отвечать по ним со ссылками.</span>
          </div>
          <Button size="sm" variant="primary" icon={<UploadCloud size={14} />} onClick={() => input.current?.click()}>
            Загрузить
          </Button>
          <input
            ref={input}
            type="file"
            hidden
            multiple
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            aria-label="Файл документа"
            onChange={(e) => {
              if (e.target.files) start(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {uploading.map((u) => (
        <div key={u.key} className="kb-upload" role="status" aria-label={`Загружается ${u.name}`}>
          <FileText size={16} aria-hidden />
          <span className="grow ellipsis">{u.name}</span>
          <span className="kb-upload-bar" aria-hidden>
            <span style={{ width: `${Math.round(u.progress * 100)}%` }} />
          </span>
        </div>
      ))}
      {docs.isLoading ? (
        <Skeleton h={160} />
      ) : docs.data?.length ? (
        <div className="card card-tight list">
          {docs.data.map((d) => (
            <div key={d.id} className="list-row kb-doc-row">
              <span className={`kb-doc-badge is-${d.type}`} aria-hidden>
                {knowledgeDocTypeLabel(d.type)}
              </span>
              <span className="grow stack" style={{ '--gap': '3px', minWidth: 0 } as React.CSSProperties}>
                <Link to={`/app/notes/docs/${d.id}`} className="kb-doc-title">
                  {d.title}
                </Link>
                <span className="faint kb-doc-meta">
                  {d.goal_title && !goalId ? (
                    <>
                      <Target size={12} aria-hidden /> {d.goal_title} ·{' '}
                    </>
                  ) : null}
                  {knowledgeDocFacts(d)} · {d.uploaded_by_name ?? 'Без автора'} · {formatDate(d.created_at.slice(0, 10), { short: true, today })}
                </span>
                {d.status === 'failed' && d.error && (
                  <span className="kb-doc-error">
                    <AlertTriangle size={13} aria-hidden /> {d.error}
                  </span>
                )}
              </span>
              <DocStatus doc={d} />
              {d.can_edit && d.status === 'failed' && (
                <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} loading={reprocess.isPending && reprocess.variables === d.id} onClick={() => reprocess.mutate(d.id)}>
                  Ещё раз
                </Button>
              )}
              {d.can_edit && <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Удалить «${d.title}»`} onClick={() => setConfirm(d)} />}
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon={<FileText size={22} />} title="Документов пока нет">
            {canUpload
              ? 'Загрузите регламенты и инструкции — помощник начнёт отвечать по ним на вопросы сотрудников.'
              : 'Документы загружает тот, кто ведёт базу знаний. Пока можно спрашивать по статьям.'}
          </Empty>
        </div>
      )}
      {confirm && <ConfirmDelete doc={confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}

/** Документ: файл, статус чтения и текст по фрагментам — то, что видит помощник. */
export function DocPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useKnowledgeDoc(id);
  const { reprocess, refresh } = useDocActions();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const today = todayIso();
  const save = useMutation({
    mutationFn: (title: string) => api<KnowledgeDoc>(`/knowledge/docs/${id}`, { method: 'PATCH', body: { title } }),
    onSuccess: async () => {
      await refresh();
      setRename(null);
      toast('Название сохранено');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields.title) setRenameError(e.fields.title);
      else toast((e as Error).message, 'error');
    },
  });

  if (q.isLoading) return <div className="page"><Skeleton h={300} /></div>;
  if (q.isError || !q.data) {
    return (
      <div className="page">
        <div className="card">
          <Empty title="Документ не найден" action={<Button onClick={() => navigate('/app/notes?tab=docs')}>К документам</Button>}>
            Его удалили, или у вас нет доступа к цели, к которой он относится.
          </Empty>
        </div>
      </div>
    );
  }
  const { doc: d, chunks } = q.data;
  const back = d.goal_id ? { to: `/app/goals/${d.goal_id}`, label: d.goal_title ?? 'Цель' } : { to: '/app/notes?tab=docs', label: 'Документы' };

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <PageHero
        variant="knowledge"
        icon={FileText}
        compact
        back={
          <Link to={back.to}>
            <ArrowLeft size={15} aria-hidden /> {back.label}
          </Link>
        }
        eyebrow={d.goal_id ? 'Документ цели' : 'Документ базы знаний'}
        title={d.title}
        subtitle={
          <span className="note-hero-meta">
            {d.goal_title && (
              <>
                <Target size={13} aria-hidden /> <Link to={`/app/goals/${d.goal_id}`}>{d.goal_title}</Link> ·{' '}
              </>
            )}
            {knowledgeDocFacts(d)} · {d.uploaded_by_name ?? 'Без автора'} · {formatDate(d.created_at.slice(0, 10), { today })}
          </span>
        }
        actions={
          <>
            {d.file && (
              <Button size="sm" icon={<Download size={14} />} onClick={() => void openFile(d.file!, 'open').catch((e) => toast((e as Error).message, 'error'))}>
                Открыть файл
              </Button>
            )}
            {d.can_edit && (
              <>
                <Button size="sm" variant="ghost" icon={<Pencil size={14} />} aria-label="Переименовать" title="Переименовать" onClick={() => (setRename(d.title), setRenameError(null))} />
                <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label="Удалить документ" title="Удалить документ" onClick={() => setConfirm(true)} />
              </>
            )}
          </>
        }
      />
      {d.status !== 'ready' ? (
        <div className="card kb-doc-state">
          <DocStatus doc={d} />
          {knowledgeDocBusy(d) ? (
            <p className="muted">Помощник читает документ и режет его на фрагменты. Обычно это занимает до минуты — страница обновится сама.</p>
          ) : (
            <>
              <p className="muted">{d.error ?? 'Документ не обработан.'}</p>
              {d.can_edit && (
                <Button icon={<RefreshCw size={15} />} loading={reprocess.isPending} onClick={() => reprocess.mutate(d.id)}>
                  Обработать ещё раз
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <section className="stack" style={{ '--gap': '12px' } as React.CSSProperties} aria-label="Текст документа">
          <div className="spread">
            <h2 className="kb-h2">Что прочитал помощник</h2>
            <span className="faint">{chunks.length} {chunks.length === 1 ? 'фрагмент' : 'фрагментов'}</span>
          </div>
          <ol className="kb-chunks">
            {chunks.map((c) => (
              <li key={c.idx} className="card kb-chunk">
                <span className="kb-chunk-n" aria-hidden>
                  {c.idx + 1}
                </span>
                <p>{c.content}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {confirm && <ConfirmDelete doc={d} onClose={() => setConfirm(false)} onDone={() => navigate(back.to, { replace: true })} />}
      {rename !== null && (
        <Dialog
          title="Название документа"
          onClose={() => setRename(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRename(null)}>
                Отмена
              </Button>
              <Button
                variant="primary"
                loading={save.isPending}
                onClick={() => {
                  const err = validateKnowledgeTitle(rename);
                  setRenameError(err);
                  if (!err) save.mutate(rename.trim());
                }}
              >
                Сохранить
              </Button>
            </>
          }
        >
          <Field label="Название" required error={renameError ?? undefined} counter={{ value: rename.length, max: KNOWLEDGE_LIMITS.title }}>
            {(p) => <input className="input" {...p} autoFocus value={rename} maxLength={KNOWLEDGE_LIMITS.title + 20} onChange={(e) => setRename(e.target.value)} />}
          </Field>
        </Dialog>
      )}
    </div>
  );
}
