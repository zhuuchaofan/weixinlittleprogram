import {
  leaveEditor,
  setEditorUnloadWarning,
} from '../../utils/editor-navigation';
import { MEDIA_LIMIT, validateVideo } from '../../services/media';
import {
  waitForMediaUploads,
  holdMediaUploads,
  MediaUploadSession,
  PendingMedia,
  rememberUploads,
  restoreUploads,
  uploadMedia,
} from '../../services/media-upload';
import { checkAdmin } from '../../services/access';
import {
  photoService,
  ManagedPhoto,
  ManagedPhotoFileInspection,
} from '../../services/photos';
import { ensurePhotoSelectionAuthorization } from '../../services/privacy';
import { previewPhotos } from '../../utils/preview';
Page({
  data: {
    pending: [] as PendingMedia[],
    authorized: false,
    loadFailed: false,
    dirty: false,
    saveState: '草稿读取中…',
    expandedId: '',
    filter: 'all',
    filterLabels: [
      '全部',
      '婚纱照相册',
      '首页封面',
      '故事照片',
      '球球',
      '布丁',
    ],
    filterIndex: 0,
    busy: false,
    error: '',
    message: '',
    diagnostic: '',
    importVisible: false,
    importId: '',
    cleanupVisible: false,
    cleanupId: '',
    cleanupInspection: null as ManagedPhotoFileInspection | null,
    photos: [] as ManagedPhoto[],
    slots: ['婚纱照相册', '首页封面', '故事照片', '球球', '布丁'],
  },
  session: null as MediaUploadSession | null,
  alive: true,
  savedSnapshot: '',
  onLoad() {
    this.alive = true;
    void this.load();
  },
  onHide() {
    this.session?.cancel();
  },
  onUnload() {
    this.alive = false;
    this.session?.cancel();
  },
  async back() {
    await leaveEditor({
      busy: this.data.busy,
      dirty: this.data.dirty || this.data.pending.length > 0,
      fallback: '/pages/admin/index',
      content: '照片说明、用途和排序尚未保存。留在这里可继续保存。',
      cancelText: '继续整理',
    });
  },
  markDirty() {
    const dirty = JSON.stringify(this.data.photos) !== this.savedSnapshot;
    this.setData({
      dirty,
      saveState: dirty
        ? '有未保存的修改'
        : '草稿已保存；发布状态以上次更新为准',
    });
    setEditorUnloadWarning(
      dirty || this.data.pending.length > 0,
      '照片安排尚未保存，返回会丢失这次修改。',
    );
  },
  markSaved(published = false) {
    this.savedSnapshot = JSON.stringify(this.data.photos);
    this.setData({
      dirty: false,
      saveState: published ? '展示已更新' : '草稿已保存，需更新展示才会发布',
    });
    setEditorUnloadWarning(
      this.data.pending.some((p) => p.status !== 'saved'),
      '有媒体尚未完成上传或保存。',
    );
  },
  toggleEdit(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id);
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },
  filterChange(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    this.setData({
      filterIndex: index,
      filter: ['all', 'album', 'cover', 'story', 'qiuqiu', 'buding'][index],
      expandedId: '',
    });
  },
  async load() {
    this.setData({ busy: true, loadFailed: false, error: '' });
    try {
      await waitForMediaUploads();
      if (!this.alive) return;
      if (!(await checkAdmin())) throw new Error('仅主人可以管理照片');
      this.setData({ authorized: true, photos: await photoService.draft() });
      const pending = restoreUploads().filter(
        (p) => !this.data.photos.some((photo) => photo.id === p.id),
      );
      this.setData({ pending });
      this.markSaved();
      this.setData({ saveState: '已读取草稿；亲友看到的是上次发布的内容' });
    } catch (e) {
      this.setData({ error: (e as Error).message, loadFailed: true });
    } finally {
      this.setData({ busy: false });
    }
  },
  copyDiagnostic() {
    if (this.data.diagnostic)
      void wx.setClipboardData({ data: this.data.diagnostic });
  },
  toggleImport() {
    this.setData({ importVisible: !this.data.importVisible });
  },
  importInput(e: WechatMiniprogram.Input) {
    this.setData({ importId: e.detail.value });
  },
  toggleCleanup() {
    this.setData({
      cleanupVisible: !this.data.cleanupVisible,
      cleanupInspection: null,
      error: '',
      message: '',
    });
  },
  cleanupInput(e: WechatMiniprogram.Input) {
    this.setData({ cleanupId: e.detail.value, cleanupInspection: null });
  },
  copyFileId(e: WechatMiniprogram.TouchEvent) {
    const photo = this.data.photos[Number(e.currentTarget.dataset.index)];
    if (!photo) return;
    void wx.setClipboardData({
      data: e.currentTarget.dataset.cover
        ? photo.coverUrl || photo.thumbnail
        : photo.original,
    });
    this.setData({
      message:
        '已复制 File ID。移除展示并更新展示后，可在下方检查是否能安全删除。',
    });
  },
  async inspectCleanup() {
    if (this.data.busy || !this.data.authorized) return;
    const fileID = this.data.cleanupId.trim();
    if (!fileID) {
      this.setData({ error: '请先粘贴需要清理的完整 File ID。' });
      return;
    }
    this.setData({ busy: true, error: '', message: '', diagnostic: '' });
    try {
      const cleanupInspection = await photoService.inspectManagedFile(fileID);
      this.setData({
        cleanupInspection,
        message: cleanupInspection.deletable
          ? '这张照片没有被草稿或已发布内容使用，可以永久删除。'
          : '这张照片仍被使用，暂时不能删除。请先移除展示、保存草稿并更新展示。',
      });
    } catch (e) {
      this.setData({ error: (e as Error).message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async deleteCleanup() {
    const inspection = this.data.cleanupInspection;
    if (this.data.busy || !inspection?.deletable) return;
    const result = await wx.showModal({
      title: '永久删除这张照片？',
      content:
        '文件将从云存储删除，无法恢复。已展示或草稿仍引用的照片不能在这里删除。',
      confirmText: '永久删除',
      confirmColor: '#783e3c',
    });
    if (!result.confirm) return;
    this.setData({ busy: true, error: '', message: '', diagnostic: '' });
    try {
      await photoService.deleteManagedFile(inspection.fileID);
      this.setData({
        cleanupId: '',
        cleanupInspection: null,
        message: '云端文件已永久删除。',
      });
    } catch (e) {
      this.setData({ error: (e as Error).message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async importPhoto() {
    if (this.data.busy || !this.data.authorized) return;
    const fileID = this.data.importId.trim();
    if (!/^cloud:\/\/[^/]+\/.+/.test(fileID) || fileID.length > 1024) {
      this.setData({ error: '请粘贴完整的 cloud:// 文件 ID。' });
      return;
    }
    if (
      this.data.photos.length +
        this.data.pending.filter(
          (p) => !this.data.photos.some((v) => v.id === p.id),
        ).length >=
      60
    ) {
      this.setData({ error: '最多安排 60 张照片，请先移除不需要的条目。' });
      return;
    }
    if (this.data.photos.some((p) => p.original === fileID)) {
      this.setData({ error: '这张照片已在当前列表中，请直接调整它的用途。' });
      return;
    }
    this.setData({ busy: true, error: '', message: '', diagnostic: '' });
    try {
      this.setData({
        photos: [
          ...this.data.photos,
          {
            id: 'photo-' + Date.now(),
            thumbnail: fileID,
            original: fileID,
            caption: '',
            slot: 'album',
            ratio: 'portrait',
            placeholder: false,
          },
        ],
      });
      if (await this.saveAddedPhoto())
        this.setData({ importId: '', importVisible: false });
    } finally {
      this.setData({ busy: false });
    }
  },
  async saveAddedPhoto() {
    this.markDirty();
    try {
      await photoService.save(this.data.photos);
      this.markSaved();
      this.setData({
        message:
          '照片已加入并保存草稿。请设置用途，再点“更新展示”，亲友才会看到。',
      });
      return true;
    } catch {
      this.setData({
        message: '',
        error:
          '照片文件已保留，但草稿保存失败。请勿退出，点击“保存草稿”重试；若已退出，可通过文件 ID 重新导入。',
      });
      return false;
    }
  },
  duplicate(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy || this.data.photos.length >= 60) return;
    const photo = this.data.photos[Number(e.currentTarget.dataset.index)];
    this.setData({
      photos: [
        ...this.data.photos,
        { ...photo, id: 'photo-' + Date.now(), slot: 'album' },
      ],
      message: '已复用这张照片，可为新条目选择其他用途，不会重复上传。',
    });
    this.markDirty();
  },
  caption(e: WechatMiniprogram.Input) {
    const photos = this.data.photos.slice();
    photos[Number(e.currentTarget.dataset.index)].caption = e.detail.value;
    this.setData({ photos });
    this.markDirty();
  },
  slot(e: WechatMiniprogram.PickerChange) {
    const photos = this.data.photos.slice();
    const index = Number(e.currentTarget.dataset.index);
    const slot = ['album', 'cover', 'story', 'qiuqiu', 'buding'][
      Number(e.detail.value)
    ];
    if (photos[index].type === 'video' && slot !== 'album') return;
    if (slot === 'cover')
      photos.forEach((p, i) => {
        if (i !== index && p.slot === 'cover') p.slot = 'album';
      });
    photos[index].slot = slot;
    this.setData({ photos });
    this.markDirty();
  },
  move(e: WechatMiniprogram.TouchEvent) {
    const photos = this.data.photos.slice();
    const i = Number(e.currentTarget.dataset.index),
      j = i + Number(e.currentTarget.dataset.delta);
    if (j < 0 || j >= photos.length) return;
    [photos[i], photos[j]] = [photos[j], photos[i]];
    this.setData({ photos });
    this.markDirty();
  },
  async remove(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const result = await wx.showModal({
      title: '从草稿移除这张照片？',
      content: '云端文件会保留，更新展示后才影响亲友页面。',
    });
    if (result.confirm && !this.data.busy) {
      this.setData({
        photos: this.data.photos.filter(
          (_, i) => i !== Number(e.currentTarget.dataset.index),
        ),
      });
      this.markDirty();
    }
  },
  preview(e: WechatMiniprogram.CustomEvent) {
    void previewPhotos(this.data.photos, Number(e.currentTarget.dataset.index));
  },
  async add(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy || !this.data.authorized || this.data.loadFailed) return;
    const remaining =
      MEDIA_LIMIT -
      this.data.photos.length -
      this.data.pending.filter(
        (p) => !this.data.photos.some((v) => v.id === p.id),
      ).length;
    if (remaining <= 0) {
      this.setData({ error: '最多安排 60 个媒体，请先移除不需要的条目。' });
      return;
    }
    const type = e.currentTarget.dataset.type === 'video' ? 'video' : 'image';
    this.setData({ busy: true, error: '', message: '' });
    try {
      await ensurePhotoSelectionAuthorization();
      const result = await wx.chooseMedia({
        count: type === 'video' ? 1 : Math.min(9, remaining),
        mediaType: [type],
        sourceType: ['album'],
        sizeType: ['compressed'],
        maxDuration: 60,
      });
      const chosen: PendingMedia[] = [];
      const failures: string[] = [];
      for (const [index, file] of result.tempFiles
        .slice(0, remaining)
        .entries()) {
        try {
          let info: WechatMiniprogram.GetVideoInfoSuccessCallbackResult | null =
            null;
          if (type === 'video') {
            try {
              info = await wx.getVideoInfo({ src: file.tempFilePath });
            } catch {
              info = null;
            }
          }
          const item: PendingMedia = {
            id:
              'media-' +
              Date.now() +
              '-' +
              index +
              '-' +
              Math.random().toString(36).slice(2, 10),
            type,
            path: file.tempFilePath,
            coverPath: file.thumbTempFilePath || '',
            size: file.size,
            // iOS 的 chooseMedia 已提供元数据；部分本地临时视频用
            // getVideoInfo 读取会返回空值，因此优先采用选择结果。
            duration: file.duration || info?.duration || 0,
            width: file.width || info?.width || 0,
            height: file.height || info?.height || 0,
            status: 'pending',
            progress: 0,
            message: '待上传',
          };
          if (type === 'video') validateVideo(item);
          chosen.push(item);
        } catch (error) {
          failures.push(
            error instanceof Error
              ? error.message
              : '无法读取视频，请选择 MP4 或 MOV 文件。',
          );
        }
      }
      if (!this.alive) return;
      const pending = [...this.data.pending, ...chosen];
      rememberUploads(pending);
      this.setData({
        pending,
        error: failures.join('；'),
        message: chosen.length
          ? '已选择，请预览并移除不需要的内容，再点击上传。'
          : '',
      });
      setEditorUnloadWarning(
        pending.length > 0 || this.data.dirty,
        '有媒体尚未完成上传或保存。',
      );
    } catch (error) {
      const message = String(
        (error as { errMsg?: string })?.errMsg ||
          (error as Error)?.message ||
          '',
      );
      if (this.alive)
        this.setData({
          error: /cancel/i.test(message)
            ? ''
            : '未能选择媒体，请确认已授权访问相册后重试。',
        });
    } finally {
      if (this.alive) this.setData({ busy: false });
    }
  },
  pendingPreview(e: WechatMiniprogram.TouchEvent) {
    const item = this.data.pending[Number(e.currentTarget.dataset.index)];
    if (item?.type === 'image')
      void wx.previewImage({
        current: item.path,
        urls: this.data.pending
          .filter((p) => p.type === 'image')
          .map((p) => p.path),
      });
  },
  async removePending(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.pending[index];
    if (!item) return;
    if (item.fileID || item.media) {
      const result = await wx.showModal({
        title: '移除待保存的媒体？',
        content:
          '已上传的云端文件会保留，可复制文件 ID 后使用云端清理功能删除。',
      });
      if (!result.confirm || this.data.busy) return;
    }
    const pending = this.data.pending.filter((_, i) => i !== index);
    rememberUploads(pending);
    this.setData({
      pending,
      photos: this.data.photos.filter((p) => p.id !== item.id),
    });
    this.markDirty();
  },
  copyPendingFile(e: WechatMiniprogram.TouchEvent) {
    const item = this.data.pending[Number(e.currentTarget.dataset.index)];
    const fileID = e.currentTarget.dataset.cover ? item?.coverID : item?.fileID;
    if (fileID) void wx.setClipboardData({ data: fileID });
  },
  async uploadPending(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy || !this.data.authorized || this.data.loadFailed) return;
    const only = e.currentTarget.dataset.id as string | undefined;
    const session = new MediaUploadSession();
    this.session = session;
    this.setData({ busy: true, error: '', message: '' });
    const finish = holdMediaUploads();
    const items = this.data.pending;
    const update = () => {
      rememberUploads(items);
      if (this.alive) this.setData({ pending: items.slice() });
    };
    try {
      for (const item of items) {
        if (session.cancelled) break;
        if (item.status === 'saved' || (only && item.id !== only)) continue;
        item.status = 'uploading';
        item.message = item.media ? '正在保存草稿…' : '正在上传…';
        update();
        try {
          const media = await uploadMedia(item, session, update);
          item.status = 'uploaded';
          item.progress = 100;
          item.message = '文件已上传，正在保存草稿…';
          update();
          session.check();
          const photos = this.data.photos.some((p) => p.id === media.id)
            ? this.data.photos
            : [...this.data.photos, media];
          this.setData({ photos });
          this.markDirty();
          await photoService.save(photos);
          item.status = 'saved';
          item.message = '已保存草稿';
          update();
          if (this.alive) this.markSaved();
        } catch (error) {
          item.status = item.media ? 'uploaded' : 'failed';
          item.message = item.media
            ? '文件已上传，草稿未确认保存。重试只保存，不重复上传。'
            : error instanceof Error
              ? error.message
              : '上传失败，请检查网络后重试；若文件已失效，请重新选择。';
          update();
        }
      }
    } finally {
      if (this.alive) {
        const pending = items.filter((p) => p.status !== 'saved');
        this.setData({
          pending,
          busy: false,
          message: pending.length
            ? '部分媒体未完成，请按条目提示重试。已成功的内容已保存。'
            : '媒体已保存草稿，点击“更新展示”后亲友可见。',
        });
        this.markDirty();
      }
      this.session = null;
      finish();
    }
  },
  async save() {
    await this.persist(false);
  },
  async publish() {
    const result = await wx.showModal({
      title: '更新亲友看到的照片？',
      content: '当前草稿将替换已展示的照片安排。',
    });
    if (result.confirm) await this.persist(true);
  },
  async persist(publish: boolean) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', message: '', diagnostic: '' });
    try {
      await (publish
        ? photoService.publish(this.data.photos)
        : photoService.save(this.data.photos));
      const pending = this.data.pending.filter(
        (p) => !this.data.photos.some((photo) => photo.id === p.id),
      );
      rememberUploads(pending);
      this.setData({ pending });
      this.markSaved(publish);
      this.setData({
        message: publish
          ? '展示已更新，重新进入相关页面即可查看。'
          : '草稿已保存。',
      });
    } catch (e) {
      this.setData({ error: (e as Error).message });
    } finally {
      this.setData({ busy: false });
    }
  },
});
