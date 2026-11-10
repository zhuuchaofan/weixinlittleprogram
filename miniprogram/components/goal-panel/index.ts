import type { Goal, SavingTip } from '../../models';
import { goalService } from '../../services/collections';
import { createLoader } from '../../services/page-load';
import { needsReload } from '../../services/snapshot';
import { errorMessage } from '../../services/cloud';
import { categoryLook } from '../../config/options';
import { formatYuan, parseYuan } from '../../utils/money';
import { goalView, type GoalRow } from '../../utils/goal';
import { memberNames, peekHousehold } from '../../services/household';

function tipRows(tips: SavingTip[]) {
  return tips.map((tip) => ({
    cat: tip.cat,
    color: categoryLook(tip.cat).color,
    averageText: formatYuan(tip.average),
    save10Text: formatYuan(tip.save10),
    save20Text: formatYuan(tip.save20),
  }));
}

const loader = createLoader();

/** 两人都在时才分开写各存了多少。 */
function pairNames() {
  const household = peekHousehold();
  return household && household.members.length > 1
    ? memberNames(household)
    : undefined;
}

/**
 * 「钱」页的「攒钱」一栏：攒钱目标、存了一笔、从哪儿省。放在花销分析页里（pages/insight），不是单独的页面。
 * 页面回到前台时调 refresh()，下拉刷新时调 load(true)。
 */
Component({
  properties: {
    themeId: { type: String, value: '' },
  },
  data: {
    loading: true,
    error: '',
    ready: false,
    busy: false,
    goals: [] as GoalRow[],
    tips: [] as ReturnType<typeof tipRows>,
  },
  lifetimes: {
    attached() {
      const goals = goalService.peek();
      if (goals) this.showGoals(goals);
      void this.load();
    },
  },
  methods: {
    /** 从新目标 / 编辑目标回来：改过才重新读。 */
    refresh() {
      if (needsReload('goals')) void this.load();
    },
    load(force = false) {
      return loader(this, {
        key: 'goals',
        force,
        fetch: () => Promise.all([goalService.list(), goalService.tips()]),
        show: ([goals, tips]) => {
          this.showGoals(goals);
          this.setData({ tips: tipRows(tips), ready: true });
        },
      });
    },
    showGoals(goals: Goal[]) {
      const names = pairNames();
      this.setData({ goals: goals.map((goal) => goalView(goal, names)) });
    },
    add() {
      wx.navigateTo({ url: '/pages/goal-edit/index' });
    },
    edit(event: WechatMiniprogram.TouchEvent) {
      wx.navigateTo({
        url: `/pages/goal-edit/index?id=${event.currentTarget.dataset.id}`,
      });
    },
    async deposit(event: WechatMiniprogram.TouchEvent) {
      const id = String(event.currentTarget.dataset.id);
      if (this.data.busy) return;
      const result = await wx.showModal({
        title: '存了一笔',
        editable: true,
        placeholderText: '金额（元），例如 500',
        confirmText: '记下',
      });
      if (!result.confirm) return;
      const amount = parseYuan(result.content || '');
      if (!amount) {
        wx.showToast({ title: '金额写到分就好，再看看', icon: 'none' });
        return;
      }
      this.setData({ busy: true, error: '' });
      try {
        const goal = await goalService.deposit(id, amount);
        this.setData({
          goals: this.data.goals.map((row) =>
            row.id === id ? goalView(goal, pairNames()) : row,
          ),
        });
        if (goal.done)
          await wx.showModal({
            title: '攒够啦！',
            content: `「${goal.title}」攒够了，你们一起做到了。`,
            showCancel: false,
            confirmText: '太好了',
          });
        else
          wx.showToast({
            title: `存了 ${formatYuan(amount)}`,
            icon: 'success',
          });
      } catch (error) {
        this.setData({ error: errorMessage(error) });
      } finally {
        this.setData({ busy: false });
      }
    },
    /** 「设分类预算」：告诉页面换到「预算」一栏。 */
    openBudgets() {
      this.triggerEvent('budgets');
    },
  },
});
