import type { ManagedPhoto } from './photos';

function references(photo: ManagedPhoto): string[] {
  return [photo.original, photo.thumbnail, photo.url, photo.coverUrl].filter(
    (value): value is string => !!value && value.startsWith('cloud://'),
  );
}

/** 同一文件即使被复用到不同展示位置，也只能有一种可见性。 */
export function setSharedVisibility(
  photos: ManagedPhoto[],
  index: number,
  visibility: 'public' | 'private',
): ManagedPhoto[] {
  const selected = photos[index];
  if (!selected) return photos;
  const shared = new Set(references(selected));
  let changed = true;
  while (changed) {
    changed = false;
    for (const photo of photos) {
      const files = references(photo);
      if (!files.some((file) => shared.has(file))) continue;
      for (const file of files)
        if (!shared.has(file)) {
          shared.add(file);
          changed = true;
        }
    }
  }
  return photos.map((photo) =>
    references(photo).some((file) => shared.has(file))
      ? { ...photo, visibility }
      : photo,
  );
}
