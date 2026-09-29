const placementOrder = ['cover', 'story', 'qiuqiu', 'buding'];
const categories = [
  'pending',
  'wedding',
  'daily',
  'baoji_0927',
  'lintong_0928',
];

class MediaLibraryError extends Error {}

function fileReferences(photo) {
  return [photo.original, photo.thumbnail, photo.url, photo.coverUrl].filter(
    (value) => typeof value === 'string' && value.startsWith('cloud://'),
  );
}

function normalizeLibrary(value) {
  const entries = Array.isArray(value) ? value : value?.photos;
  if (!Array.isArray(entries)) return [];
  const groups = new Map();
  entries.forEach((raw, index) => {
    const p = typeof raw === 'string' ? { imageUrl: raw } : raw || {};
    const type = p.type === 'video' ? 'video' : 'image';
    const original = p.original || p.url || p.imageUrl || p.thumbnail || '';
    const photo = {
      ...p,
      id: p.id || 'legacy-' + index,
      type,
      original,
      thumbnail:
        type === 'video'
          ? p.coverUrl || p.thumbnail || ''
          : p.thumbnail || original,
      caption: p.caption || '',
      ratio: p.ratio || 'portrait',
      placeholder: p.placeholder ?? !original,
    };
    const key = original ? type + ':' + original : 'empty:' + index;
    const group = groups.get(key) || [];
    group.push({ photo, index });
    groups.set(key, group);
  });
  return [...groups.values()]
    .sort(
      (a, b) =>
        (a.find(({ photo }) => photo.slot === 'album')?.index ?? a[0].index) -
        (b.find(({ photo }) => photo.slot === 'album')?.index ?? b[0].index),
    )
    .map((group) => {
      const preferred =
        group.find(({ photo }) => photo.slot === 'album')?.photo ||
        group[0].photo;
      const placements = new Set();
      group.forEach(({ photo }) => {
        if (photo.type === 'video') return;
        (Array.isArray(photo.placements) ? photo.placements : []).forEach(
          (placement) => {
            if (placementOrder.includes(placement)) placements.add(placement);
          },
        );
        if (placementOrder.includes(photo.slot)) placements.add(photo.slot);
      });
      const albumCategory = group
        .filter(({ photo }) => photo.slot === 'album')
        .map(({ photo }) => photo.category)
        .find((candidate) => categories.includes(candidate));
      const otherCategory = group
        .map(({ photo }) => photo.category)
        .find((candidate) => categories.includes(candidate));
      const category =
        preferred.type === 'video'
          ? undefined
          : placements.has('qiuqiu') || placements.has('buding')
            ? 'daily'
            : albumCategory || otherCategory || 'pending';
      const base = { ...preferred };
      delete base.slot;
      delete base.imageUrl;
      return {
        ...base,
        ...(category ? { category } : {}),
        visibility: group.some(({ photo }) => photo.visibility === 'private')
          ? 'private'
          : 'public',
        placements: placementOrder.filter((placement) =>
          placements.has(placement),
        ),
      };
    });
}

function validateLibrary(
  value,
  previousPublished = [],
  requireCategories = false,
) {
  if (!Array.isArray(value) || value.length > 60)
    throw new MediaLibraryError('最多保存 60 个媒体文件');
  const ids = new Set();
  const originals = new Set();
  const visibilityByFile = new Map();
  const photos = value.map((p) => {
    if (
      !p ||
      typeof p.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) ||
      ids.has(p.id)
    )
      throw new MediaLibraryError('媒体编号无效或重复');
    ids.add(p.id);
    if (
      typeof p.original !== 'string' ||
      !p.original.startsWith('cloud://') ||
      p.original.length > 1024 ||
      originals.has(p.original)
    )
      throw new MediaLibraryError('同一云文件只能保存一条媒体记录');
    originals.add(p.original);
    if (
      typeof p.thumbnail !== 'string' ||
      (p.thumbnail && !p.thumbnail.startsWith('cloud://')) ||
      (!p.thumbnail && p.type !== 'video') ||
      p.thumbnail.length > 1024 ||
      typeof p.caption !== 'string' ||
      p.caption.length > 80 ||
      !['portrait', 'landscape', 'square'].includes(p.ratio)
    )
      throw new MediaLibraryError('媒体信息无效');
    const type = p.type === 'video' ? 'video' : 'image';
    if (p.type && !['image', 'video'].includes(p.type))
      throw new MediaLibraryError('媒体类型无效');
    const placements = p.placements || [];
    if (
      !Array.isArray(placements) ||
      new Set(placements).size !== placements.length ||
      placements.some((item) => !placementOrder.includes(item))
    )
      throw new MediaLibraryError('精选展示位置无效');
    if (!['public', 'private'].includes(p.visibility))
      throw new MediaLibraryError('媒体可见性无效');
    if (type === 'video') {
      if (
        placements.length ||
        p.category !== undefined ||
        !Number.isFinite(p.duration) ||
        p.duration <= 0 ||
        p.duration > 60 ||
        !Number.isFinite(p.size) ||
        p.size <= 0 ||
        p.size > 30 * 1024 * 1024 ||
        !Number.isFinite(p.width) ||
        p.width <= 0 ||
        !Number.isFinite(p.height) ||
        p.height <= 0 ||
        (p.coverUrl &&
          (typeof p.coverUrl !== 'string' ||
            !p.coverUrl.startsWith('cloud://') ||
            p.coverUrl.length > 1024))
      )
        throw new MediaLibraryError('视频信息无效');
    } else if (
      !categories.includes(p.category) ||
      ((placements.includes('qiuqiu') || placements.includes('buding')) &&
        p.category !== 'daily')
    )
      throw new MediaLibraryError('请为照片选择有效相册；猫咪照片属于日常照');
    const photo = {
      id: p.id,
      type,
      original: p.original,
      thumbnail: p.thumbnail,
      url: p.original,
      caption: p.caption,
      ratio: p.ratio,
      placeholder: false,
      visibility: p.visibility,
      placements: placementOrder.filter((item) => placements.includes(item)),
      ...(type === 'image' ? { category: p.category } : {}),
      ...(type === 'video'
        ? {
            coverUrl: p.coverUrl || '',
            duration: p.duration,
            size: p.size,
            width: p.width,
            height: p.height,
          }
        : {}),
    };
    for (const file of fileReferences(photo)) {
      const known = visibilityByFile.get(file);
      if (known && known !== photo.visibility)
        throw new MediaLibraryError('同一云文件不能同时设置公开和私密');
      visibilityByFile.set(file, photo.visibility);
    }
    return photo;
  });
  if (photos.filter((photo) => photo.placements.includes('cover')).length > 1)
    throw new MediaLibraryError('首页只能设置一张封面');
  const historic = new Set(
    normalizeLibrary(previousPublished).map((photo) => photo.original),
  );
  if (
    requireCategories &&
    photos.some(
      (photo) =>
        photo.type === 'image' &&
        photo.category === 'pending' &&
        !historic.has(photo.original),
    )
  )
    throw new MediaLibraryError('请先为新增照片选择分类再更新展示');
  return photos;
}

function projectLegacyLibrary(value) {
  return normalizeLibrary(value).flatMap((photo, index) => {
    const { placements, ...base } = photo;
    const items = [{ ...base, slot: 'album' }];
    if (photo.type !== 'video')
      placements.forEach((slot) =>
        items.push({
          ...base,
          id: 'legacy-' + index + '-' + slot,
          slot,
          category: undefined,
        }),
      );
    return items;
  });
}

module.exports = {
  MediaLibraryError,
  normalizeLibrary,
  validateLibrary,
  projectLegacyLibrary,
};
