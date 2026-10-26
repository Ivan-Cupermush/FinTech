import { useQueryClient } from '@tanstack/react-query';
import { TASK_FILES_MAX, type Attachment, type TaskDetail } from '@offix/core';
import { ApiError, api } from '../../lib/api';
import { dropDraft } from '../../lib/files';
import { qk, useMe } from '../../lib/queries';
import { useUploads } from '../../lib/useUploads';
import { useToast } from '../../ui/Toast';
import { AttachButton, AttachmentList, PendingList, useDropZone } from './Attachments';

const errText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не получилось, попробуйте ещё раз');

/**
 * Файлы задачи: ТЗ, сканы, результат работы. Прикрепляет исполнитель,
 * автор или руководитель; свой файл можно убрать, чужой — тот, кто правит задачу.
 */
export function TaskFiles({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const up = useUploads();
  const perms = task.permissions;
  const canAttach = !!perms && (perms.edit || perms.status) && me.data?.role !== 'observer';
  const files = task.files ?? [];
  const left = TASK_FILES_MAX - files.length;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.task(task.id) });
  };
  const attach = async (list: File[]) => {
    if (list.length > left) {
      toast(`К задаче — не больше ${TASK_FILES_MAX} файлов`, 'error');
      list = list.slice(0, Math.max(0, left));
    }
    if (!list.length) return;
    const atts = await up.upload(list);
    if (!atts.length) return;
    try {
      const next = await api<Attachment[]>(`/tasks/${task.id}/files`, { body: { attachment_ids: atts.map((a) => a.id) } });
      qc.setQueryData<TaskDetail>(qk.task(task.id), (t) => (t ? { ...t, files: next } : t));
      toast(atts.length > 1 ? `Прикреплено файлов: ${atts.length}` : 'Файл прикреплён');
    } catch (e) {
      atts.forEach((a) => void dropDraft(a.id));
      toast(errText(e), 'error');
    }
  };
  const remove = async (a: Attachment) => {
    try {
      await api(`/tasks/${task.id}/files/${a.id}`, { method: 'DELETE' });
      qc.setQueryData<TaskDetail>(qk.task(task.id), (t) => (t ? { ...t, files: t.files.filter((f) => f.id !== a.id) } : t));
    } catch (e) {
      toast(errText(e), 'error');
      refresh();
    }
  };
  const drop = useDropZone((l) => void attach(l), canAttach);

  if (!files.length && !canAttach) return null;
  return (
    <section className={`task-files ${drop.over ? 'is-over' : ''}`} aria-label="Файлы задачи" {...drop.props}>
      <div className="spread">
        <div className="eyebrow">Файлы{files.length ? ` · ${files.length}` : ''}</div>
        {canAttach && <AttachButton onFiles={(l) => void attach(l)} disabled={left <= 0} />}
      </div>
      {files.length ? (
        <AttachmentList items={files} canRemove={(a) => !!perms && (perms.edit || (a.uploaded_by === me.data?.id && perms.status))} onRemove={(a) => void remove(a)} />
      ) : (
        !up.items.length && <p className="faint task-files-empty">Перетащите сюда ТЗ, сканы или результат работы — до {TASK_FILES_MAX} файлов.</p>
      )}
      <PendingList items={up.items} onDismiss={up.dismiss} />
    </section>
  );
}
