import type { Attachment } from '@offix/core';
import { Image, type ImageProps } from 'react-native';
import { usePreviewUrl } from '../lib/files';

/** Миниатюра с обновлением подписи и повторной проверкой доступа. */
export function PreviewImage({ attachment, ...props }: { attachment: Attachment } & Omit<ImageProps, 'source'>) {
  const uri = usePreviewUrl(attachment);
  return uri ? <Image {...props} source={{ uri }} /> : null;
}
