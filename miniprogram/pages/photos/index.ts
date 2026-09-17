import { preparePhotoUpload } from '../../services/photo-upload';
import { localConfig } from '../../config/local';
import { checkAdmin } from '../../services/access';
import {
  photoService,
  ManagedPhoto,
  ManagedPhotoFileInspection,
} from '../../services/photos';
import { ensurePhotoSelectionAuthorization } from '../../services/privacy';
import { callCloud, CloudRequestError } from '../../services/cloud';
import { previewPhotos } from '../../utils/preview';
Page({
  data: {
    authorized: false,
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
  async onLoad() {
    this.setData({ busy: true });
    try {
      if (!(await checkAdmin())) throw new Error('仅主人可以管理照片');
      this.setData({ authorized: true, photos: await photoService.draft() });
    } catch (e) {
      this.setData({ error: (e as Error).message });
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
    void wx.setClipboardData({ data: photo.original });
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
    if (this.data.photos.length >= 60) {
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
    try {
      await photoService.save(this.data.photos);
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
  },
  caption(e: WechatMiniprogram.Input) {
    const photos = this.data.photos.slice();
    photos[Number(e.currentTarget.dataset.index)].caption = e.detail.value;
    this.setData({ photos });
  },
  slot(e: WechatMiniprogram.PickerChange) {
    const photos = this.data.photos.slice();
    const index = Number(e.currentTarget.dataset.index);
    const slot = ['album', 'cover', 'story', 'qiuqiu', 'buding'][
      Number(e.detail.value)
    ];
    if (slot === 'cover')
      photos.forEach((p, i) => {
        if (i !== index && p.slot === 'cover') p.slot = 'album';
      });
    photos[index].slot = slot;
    this.setData({ photos });
  },
  move(e: WechatMiniprogram.TouchEvent) {
    const photos = this.data.photos.slice();
    const i = Number(e.currentTarget.dataset.index),
      j = i + Number(e.currentTarget.dataset.delta);
    if (j < 0 || j >= photos.length) return;
    [photos[i], photos[j]] = [photos[j], photos[i]];
    this.setData({ photos });
  },
  async remove(e: WechatMiniprogram.TouchEvent) {
    const result = await wx.showModal({
      title: '从草稿移除这张照片？',
      content: '云端文件会保留，更新展示后才影响亲友页面。',
    });
    if (result.confirm)
      this.setData({
        photos: this.data.photos.filter(
          (_, i) => i !== Number(e.currentTarget.dataset.index),
        ),
      });
  },
  preview(e: WechatMiniprogram.CustomEvent) {
    void previewPhotos(this.data.photos, Number(e.currentTarget.dataset.index));
  },
  async add() {
    if (this.data.busy || !this.data.authorized) return;
    if (this.data.photos.length >= 60) {
      this.setData({ error: '最多安排 60 张照片，请先移除不再展示的照片。' });
      return;
    }
    this.setData({ busy: true, error: '', message: '', diagnostic: '' });
    try {
      await ensurePhotoSelectionAuthorization();
      const result = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
      });
      this.setData({ message: '正在调整照片大小，请稍候…' });
      const { path, base64 } = await preparePhotoUpload(
        result.tempFiles[0].tempFilePath,
      );
      const info = await wx.getImageInfo({ src: path });
      this.setData({ message: '正在上传照片，请稍候…' });
      const uploaded =
        String(localConfig.mode) === 'mock'
          ? {
              fileID: await new Promise<string>((resolve, reject) =>
                wx.getFileSystemManager().saveFile({
                  tempFilePath: path,
                  success: (r) => resolve(r.savedFilePath),
                  fail: reject,
                }),
              ),
            }
          : await callCloud<{ fileID: string }>('uploadPhoto', { base64 });
      this.setData({
        photos: [
          ...this.data.photos,
          {
            id: 'photo-' + Date.now(),
            thumbnail: uploaded.fileID,
            original: uploaded.fileID,
            caption: '',
            slot: 'album',
            ratio:
              info.width === info.height
                ? 'square'
                : info.width > info.height
                  ? 'landscape'
                  : 'portrait',
            placeholder: false,
          },
        ],
        message: '上传完成，正在保存草稿…',
      });
      await this.saveAddedPhoto();
    } catch (e) {
      const nativeMessage = String(
        (e as { errMsg?: string })?.errMsg || (e as Error)?.message || '',
      );
      if (/cancel/i.test(nativeMessage)) {
        this.setData({ message: '', error: '', diagnostic: '' });
        return;
      }
      this.setData({
        message: '',
        diagnostic: e instanceof CloudRequestError ? e.diagnostic : '',
        error: (e as Error).message || '未完成上传，可重新选择照片重试。',
      });
    } finally {
      this.setData({ busy: false });
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
