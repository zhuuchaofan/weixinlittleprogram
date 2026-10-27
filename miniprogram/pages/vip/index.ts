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
    busy: false,
    error: '',
    message: '',
    info: null as VipInfo | null,
    // 不开通时的每日次数，来自契约。
    baseImages: CONTRACT.billImport.dailyImages,
    baseSummaries: CONTRACT.aiSummary.daily,
    untilText: '',
    plans: [] as { id: string; name: string; days: number; price: string }[],
    // 购买须知里的「月度会员 31 天，年度会员 366 天」。
    plansText: '',
    // 选中的套餐：一页只有一个「开通 / 续费」按钮。
    selected: '',
    selectedPrice: '',
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
    const plans = info.plans.map((plan) => ({
      ...plan,
      price: formatYuan(plan.price),
    }));
    // 默认选第一个套餐；刷新后保留之前的选择。
    const selected =
      plans.find((plan) => plan.id === this.data.selected) || plans[0];
    this.setData({
      info,
      untilText: info.until ? todayKey(info.until) : '',
      plans,
      plansText: plans.map((plan) => `${plan.name} ${plan.days} 天`).join('，'),
      selected: selected?.id || '',
      selectedPrice: selected?.price || '',
    });
  },
  pick(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const plan = this.data.plans.find(
      (item) => item.id === event.currentTarget.dataset.id,
    );
    if (plan) this.setData({ selected: plan.id, selectedPrice: plan.price });
  },
  async buy() {
    if (this.data.busy || !this.data.selected) return;
    this.setData({ busy: true, error: '', message: '' });
    try {
      const before = this.data.info?.until || 0;
      const info = await buyVip(this.data.selected);
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
      this.setData({ busy: false });
    }
  },
  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },
});
