import { getHousehold, updateHousehold } from '../../services/household';
import { getInsight } from '../../services/insight';
import { errorMessage } from '../../services/cloud';
import { CATEGORIES, categoryLook } from '../../config/options';
import { fenToInput, formatYuan, parseYuan } from '../../utils/money';
import { todayKey } from '../../utils/date';

type Row = {
  cat: string;
  color: string;
  value: string;
  /** 参考：上个月这一类花了多少。 */
  hint: string;
};

/**
 * 「钱」页的「预算」一栏：给想控制的几类填每月上限。放在花销分析页里（pages/insight），不是单独的页面。
 * themeId 由页面传进来（读取中的猫爪印跟主题走）。
 */
Component({
  properties: {
    themeId: { type: String, value: '' },
  },
  data: {
    rows: [] as Row[],
    loading: true,
    busy: false,
    error: '',
  },
  lifetimes: {
    attached() {
      void this.load();
    },
  },
  methods: {
    async load() {
      try {
        const household = await getHousehold();
        const budgets = household?.budgets || {};
        this.setData({
          rows: CATEGORIES.map((cat) => ({
            cat,
            color: categoryLook(cat).color,
            value: budgets[cat] ? fenToInput(budgets[cat]) : '',
            hint: '',
          })),
        });
      } catch (error) {
        this.setData({ error: errorMessage(error) });
      } finally {
        this.setData({ loading: false });
      }
      // 上个月各类花了多少，只作参考；读不到不影响设置。
      try {
        const insight = await getInsight(todayKey().slice(0, 7));
        const prev = new Map(
          insight.byCategory.map((row) => [row.cat, row.prev]),
        );
        this.setData({
          rows: this.data.rows.map((row) => ({
            ...row,
            hint: prev.get(row.cat)
              ? `上月 ${formatYuan(prev.get(row.cat) || 0)}`
              : '',
          })),
        });
      } catch {
        // 忽略
      }
    },
    input(event: WechatMiniprogram.Input) {
      const index = Number(event.currentTarget.dataset.index);
      this.setData({ [`rows[${index}].value`]: event.detail.value });
    },
    /** 保存后留在这一栏，只轻提示一下（这里不是编辑页，没有上一页可回）。 */
    async save() {
      if (this.data.busy) return;
      const budgets: Record<string, number> = {};
      for (const row of this.data.rows) {
        const text = row.value.trim();
        if (!text) continue;
        const amount = parseYuan(text);
        if (!amount && Number(text) !== 0) {
          this.setData({ error: `${row.cat}的金额写到分就好，再看看。` });
          return;
        }
        if (amount) budgets[row.cat] = amount;
      }
      this.setData({ busy: true, error: '' });
      try {
        await updateHousehold({ budgets });
        wx.showToast({ title: '已保存', icon: 'success' });
      } catch (error) {
        this.setData({ error: errorMessage(error) });
      } finally {
        this.setData({ busy: false });
      }
    },
  },
});
