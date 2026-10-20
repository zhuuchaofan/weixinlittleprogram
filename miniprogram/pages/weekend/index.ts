import type { AiWeekendItem, Wish } from '../../models';
import { requireHousehold } from '../../services/household';
import { wishService } from '../../services/collections';
import { aiAvailable, aiSuggest } from '../../services/ai';
import { errorMessage } from '../../services/cloud';

let loadVersion = 0;

const CONDITIONS = {
  dur: ['半天', '一天', '两天一夜'],
  mood: ['放松', '热闹', '自然', '美食'],
  budget: ['5千日元内', '1万日元内', '不限'],
  trans: ['步行', '电车', '开车'],
};

Page({
  data: {
    wishes: [] as Wish[],
    city: '',
    conditions: CONDITIONS,
    groups: [
      { key: 'dur', label: '时长' },
      { key: 'mood', label: '心情' },
      { key: 'budget', label: '预算' },
      { key: 'trans', label: '交通' },
    ],
    picked: { dur: '一天', mood: '放松', budget: '1万日元内', trans: '电车' },
    aiEnabled: false,
    aiItems: [] as AiWeekendItem[],
    aiBusy: false,
    loading: true,
    busy: false,
    error: '',
  },
  onLoad() {
    void aiAvailable('weekend').then((aiEnabled) =>
      this.setData({ aiEnabled }),
    );
  },
  onShow() {
    void this.load();
  },
  async load() {
    const version = ++loadVersion;
    this.setData({ loading: true, error: '' });
    try {
      const household = await requireHousehold();
      if (!household) return;
      const wishes = await wishService.list();
      if (version === loadVersion)
        this.setData({ wishes, city: household.city });
    } catch (error) {
      if (version === loadVersion) this.setData({ error: errorMessage(error) });
    } finally {
      if (version === loadVersion) this.setData({ loading: false });
    }
  },
  add() {
    wx.navigateTo({ url: '/pages/wish-edit/index' });
  },
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/wish-edit/index?id=${event.currentTarget.dataset.id}`,
    });
  },
  pick(event: WechatMiniprogram.TouchEvent) {
    const { field, value } = event.currentTarget.dataset as {
      field: string;
      value: string;
    };
    this.setData({ [`picked.${field}`]: value });
  },
  async askAi() {
    if (this.data.aiBusy) return;
    this.setData({ aiBusy: true, error: '', aiItems: [] });
    try {
      const result = await aiSuggest<AiWeekendItem>('weekend', {
        ...this.data.picked,
        city: this.data.city,
      });
      if (result.disabled) this.setData({ aiEnabled: false });
      else this.setData({ aiItems: result.items });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ aiBusy: false });
    }
  },
  async keepAi(event: WechatMiniprogram.TouchEvent) {
    const item = this.data.aiItems[Number(event.currentTarget.dataset.index)];
    if (!item || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      await wishService.add({
        title: item.title.slice(0, 30),
        why: item.why.slice(0, 100),
        plan: [item.plan, item.cost].filter(Boolean).join('；').slice(0, 200),
      });
      await this.load();
      wx.showToast({ title: '已收藏', icon: 'success' });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
