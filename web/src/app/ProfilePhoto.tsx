import { useQueryClient } from '@tanstack/react-query';
import { Camera, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Me } from '@offix/core';
import { ApiError, api } from '../lib/api';
import { avatarsKey } from '../lib/avatars';
import { uploadAvatar } from '../lib/files';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Misc';
import { useToast } from '../ui/Toast';

/**
 * Мини-профиль: фото, которое коллеги видят в чатах, задачах и обсуждениях.
 * Сервер обрезает снимок в квадрат и стирает из него метаданные.
 */
export function ProfilePhotoDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const has = !!me.avatar_url;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: avatarsKey });
    void qc.invalidateQueries({ queryKey: ['me'] });
  };
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      await uploadAvatar(file, { onProgress: setProgress });
      refresh();
      toast('Фото обновлено');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не удалось загрузить фото');
    } finally {
      setProgress(null);
    }
  };
  const remove = async () => {
    try {
      await api('/files/avatar', { method: 'DELETE' });
      refresh();
      toast('Фото удалено');
      onClose();
    } catch {
      setError('Не получилось удалить фото — попробуйте ещё раз');
    }
  };

  return (
    <Dialog title="Фото профиля" onClose={onClose}>
      <div className="profile-photo">
        <span className="profile-photo-ring" style={{ '--p': progress ?? 0 } as React.CSSProperties} data-busy={progress !== null || undefined}>
          <Avatar name={me.display_name} id={me.id} size={132} />
        </span>
        <div className="profile-photo-who">
          <b>{me.display_name}</b>
          <span className="faint">{me.position ?? me.email}</span>
        </div>
        <p className="faint profile-photo-note">Фото видят коллеги в чатах, задачах и обсуждениях. Квадрат 512 px, без геометки и данных камеры.</p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="row profile-photo-actions">
          <Button variant="primary" icon={<Camera size={16} />} loading={progress !== null} onClick={() => input.current?.click()}>
            {has ? 'Заменить фото' : 'Загрузить фото'}
          </Button>
          {has && (
            <Button variant="ghost" icon={<Trash2 size={16} />} onClick={remove} disabled={progress !== null}>
              Удалить
            </Button>
          )}
        </div>
        <input ref={input} type="file" accept="image/*" hidden aria-label="Файл фото" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
    </Dialog>
  );
}
