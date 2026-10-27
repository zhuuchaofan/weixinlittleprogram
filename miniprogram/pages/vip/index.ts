import { errorMessage } from '../../services/cloud';
import { applyTheme, themeData } from '../../services/theme';
import { buyVip, getVip, type VipInfo } from '../../services/vip';
import { formatYuan } from '../../utils/money';
import { todayKey } from '../../utils/date';
import { CONTRACT } from '../../config/contract';

Page({
  data: {
    ...themeData(),
    loading: true,
    busy: '',
    error: '',
    message: '',
    info: null as VipInfo | null,
    // 不开通时的每日次数，来自契约。
    baseImages: CONTRACT.billImport.dailyImages,
    baseSummaries: CONTRACT.aiSummary.daily,
    untilText: '',
    plans: [] as { id: string; name: string; days: number; price: string }[],
  },
  onShow() {
    applyTheme(this);
  },
  onLoad() {
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      this.show(await getVip());
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },
  show(info: VipInfo) {
    this.setData({
      info,
      untilText: info.until ? todayKey(info.until) : '',
      plans: info.plans.map((plan) => ({
        ...plan,
        price: formatYuan(plan.price),
      })),
    });
  },
  async buy(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const id = String(event.currentTarget.dataset.id);
    this.setData({ busy: id, error: '', message: '' });
    try {
      const before = this.data.info?.until || 0;
      const info = await buyVip(id);
      this.show(info);
      this.setData({
        message:
          info.until > before
            ? '开通成功，两个人都能用上啦。'
            : '支付已完成，会员生效可能有几秒延迟，稍后下拉刷新看看。',
      });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: '' });
    }
  },
  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },
});
