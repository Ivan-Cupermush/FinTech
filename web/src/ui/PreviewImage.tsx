import type { Attachment } from '@offix/core';
import type { ImgHTMLAttributes } from 'react';
import { usePreviewUrl } from '../lib/files';

/** Миниатюра с обновлением подписи и повторной проверкой доступа. */
export function PreviewImage({ attachment, ...props }: { attachment: Attachment } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const src = usePreviewUrl(attachment);
  return src ? <img {...props} src={src} /> : null;
}
