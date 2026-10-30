import type { WishInput } from '../../models';
import { wishService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import { confirmAction } from '../../utils/confirm';
import { LENGTHS, PHOTO_LIMITS } from '../../config/options';
import { getHousehold } from '../../services/household';
import {
  discardPhotos,
  photoUrls,
  pickPhotos,
  uploadWishPhoto,
} from '../../services/photos';
import { todayKey } from '../../utils/date';
import { applyTheme, themeData } from '../../services/theme';

/** 这次编辑里新传的照片；没保存就离开要删掉。 */
let uploaded: string[] = [];
let saved = false;
let householdId = '';

Page({
  data: {
    ...themeData(),
    limits: LENGTHS,
    id: '',
    title: '',
    // 旧数据的「为什么想去」和「怎么安排」合在一起显示，保存时都存进 plan。
    note: '',
    done: false,
    doneOn: '',
    memo: '',
    photos: [] as string[],
    shown: [] as Array<{ id: string; url: string }>,
    urls: {} as Record<string, string>,
    photosChanged: false,
    limit: PHOTO_LIMITS.free as number,
    isVip: false,
    uploading: false,
    today: todayKey(),
    busy: false,
    error: '',
  },
  onShow() {
    applyTheme(this);
  },
  onUnload() {
    if (!saved) discardPhotos(uploaded);
    uploaded = [];
    saved = false;
  },
  async onLoad(options: Record<string, string | undefined>) {
    uploaded = [];
    saved = false;
    if (!options.id) return;
    let wish;
    try {
      wish = await wishService.get(options.id);
    } catch (error) {
      this.setData({ error: errorMessage(error) });
      return;
    }
    this.setData({
      id: wish.id,
      title: wish.title,
      note: [wish.why, wish.plan].filter(Boolean).join('\n'),
      done: wish.done === true,
      doneOn: wish.doneOn || todayKey(),
      memo: wish.memo || '',
      photos: wish.photos || [],
    });
    void this.loadPhotos();
    try {
      const household = await getHousehold();
      if (household) {
        householdId = household.id;
        const isVip = household.vip.active;
        this.setData({
          isVip,
          limit: isVip ? PHOTO_LIMITS.vip : PHOTO_LIMITS.free,
        });
      }
    } catch {
      // 取不到会员状态就按普通的张数限制显示，保存时云端还会再核对。
    }
  },
  async loadPhotos() {
    const ids = this.data.photos;
    const urls = await photoUrls(ids);
    this.setData({
      urls,
      shown: ids.filter((id) => urls[id]).map((id) => ({ id, url: urls[id] })),
    });
  },
  async addPhotos() {
    const room = this.data.limit - this.data.photos.length;
    if (this.data.uploading) return;
    if (room <= 0) {
      wx.showToast({
        title: this.data.isVip ? '照片已经满啦' : '开通会员可放更多照片',
        icon: 'none',
      });
      return;
    }
    const paths = await pickPhotos(room);
    if (!paths.length) return;
    this.setData({ uploading: true, error: '' });
    try {
      if (!householdId) householdId = (await getHousehold())?.id || '';
      const ids: string[] = [];
      for (const [index, path] of paths.entries()) {
        const id = await uploadWishPhoto(householdId, path, index);
        ids.push(id);
        uploaded.push(id);
      }
      this.setData({
        photos: [...this.data.photos, ...ids],
        photosChanged: true,
      });
      await this.loadPhotos();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ uploading: false });
    }
  },
  removePhoto(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id);
    if (uploaded.includes(id)) {
      discardPhotos([id]);
      uploaded = uploaded.filter((item) => item !== id);
    }
    this.setData({
      photos: this.data.photos.filter((item) => item !== id),
      shown: this.data.shown.filter((item) => item.id !== id),
      photosChanged: true,
    });
  },
  previewPhoto(event: WechatMiniprogram.TouchEvent) {
    const current = String(event.currentTarget.dataset.url);
    void wx.previewImage({
      current,
      urls: this.data.shown.map((item) => item.url),
    });
  },
  input(event: WechatMiniprogram.Input) {
    this.setData({
      [String(event.currentTarget.dataset.field)]: event.detail.value,
    });
  },
  /** 去攒钱页新建目标，名称带上这个想去的地方。 */
  saveFor() {
    const title = this.data.title.trim();
    wx.navigateTo({
      url: `/pages/goal-edit/index?title=${encodeURIComponent(title)}`,
    });
  },
  toggleDone(event: WechatMiniprogram.SwitchChange) {
    this.setData({ done: event.detail.value });
  },
  pickDate(event: WechatMiniprogram.PickerChange) {
    this.setData({ doneOn: String(event.detail.value) });
  },
  async save() {
    if (this.data.busy) return;
    const { done } = this.data;
    const input: WishInput = {
      title: this.data.title.trim(),
      why: '',
      plan: this.data.note.trim().slice(0, LENGTHS.wishPlan),
      done,
      doneOn: done ? this.data.doneOn : '',
      memo: this.data.memo.trim().slice(0, LENGTHS.wishMemo),
    };
    if (this.data.photosChanged) input.photos = this.data.photos;
    if (!input.title) {
      this.setData({ error: '请写下想去的地方或想做的事。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      if (this.data.id) await wishService.update(this.data.id, input);
      else await wishService.add(input);
      saved = true;
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  async remove() {
    if (this.data.busy || !this.data.id) return;
    if (!(await confirmAction('删除这条收藏？', '删除后无法恢复。'))) return;
    this.setData({ busy: true, error: '' });
    try {
      await wishService.remove(this.data.id);
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
