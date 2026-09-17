import { localConfig } from '../../config/local';
import { checkAdmin } from '../../services/access';
import { photoService, ManagedPhoto } from '../../services/photos';
import { callCloud } from '../../services/cloud';
import { previewPhotos } from '../../utils/preview';
Page({
  data: {
    authorized: false,
    busy: false,
    error: '',
    message: '',
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
    if (this.data.busy) return;
    if (this.data.photos.length >= 60) {
      this.setData({ error: '最多安排 60 张照片，请先移除不再展示的照片。' });
      return;
    }
    this.setData({ busy: true, error: '', message: '' });
    try {
      const result = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
      });
      const file = result.tempFiles[0];
      let path = file.tempFilePath;
      if (file.size > 450000)
        path = (
          await wx.compressImage({
            src: path,
            quality: 65,
            compressedWidth: 1600,
          })
        ).tempFilePath;
      const info = await wx.getImageInfo({ src: path });
      const readBase64 = (filePath: string) =>
        new Promise<string>((resolve, reject) =>
          wx.getFileSystemManager().readFile({
            filePath,
            encoding: 'base64',
            success: (r) => resolve(r.data as string),
            fail: reject,
          }),
        );
      let base64 = await readBase64(path);
      for (const width of [1200, 960, 720]) {
        if (base64.length <= 700000) break;
        path = (
          await wx.compressImage({
            src: path,
            quality: 55,
            compressedWidth: width,
          })
        ).tempFilePath;
        base64 = await readBase64(path);
      }
      this.setData({ message: '正在上传照片，请稍候…' });
      if (base64.length > 700000)
        throw new Error(
          '压缩后仍偏大，请选择更小的 JPG 或 PNG 照片（约 500 KB 内）。',
        );
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
        message: '上传完成，请选择用途并保存草稿。',
      });
    } catch (e) {
      this.setData({
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
    this.setData({ busy: true, error: '', message: '' });
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
