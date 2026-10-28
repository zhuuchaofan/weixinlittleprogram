import { clearCount, clearRecords } from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { exportAllText } from '../../services/export';
import { applyTheme, themeData } from '../../services/theme';
import { confirmAction } from '../../utils/confirm';

type Scope = 'others' | 'all';

/**
 * 清空记录：只在小家里只剩自己时能用（设置里才有入口）。
 * 「只清对方记的」按每条的记录人算；对方带走的副本在对方自己的小家里，这里动不到。
 */
Page({
  data: {
    ...themeData(),
    loading: true,
    scope: 'others' as Scope,
    counts: { all: 0, others: 0 },
    busy: false,
    exporting: false,
    error: '',
    message: '',
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
      this.setData({ counts: await clearCount() });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },
  chooseScope(event: WechatMiniprogram.TouchEvent) {
    this.setData({ scope: event.currentTarget.dataset.scope as Scope });
  },
  async exportData() {
    if (this.data.exporting) return;
    this.setData({ exporting: true, error: '', message: '' });
    try {
      await wx.setClipboardData({ data: await exportAllText() });
      this.setData({
        message: '全部数据已复制，可以粘贴到备忘录或文件里保存。',
      });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ exporting: false });
    }
  },
  async clear() {
    const { scope, counts, busy } = this.data;
    const count = counts[scope];
    if (busy || !count) return;
    const what = scope === 'all' ? '全部记录' : '对方记的记录';
    if (
      !(await confirmAction(
        `删掉 ${count} 条？`,
        `会删掉这个小家里${what}共 ${count} 条，删了找不回来。还没备份的话，先点「先复制全部数据」。`,
      ))
    )
      return;
    this.setData({ busy: true, error: '', message: '' });
    try {
      const removed = await clearRecords(scope, () =>
        this.setData({ message: '对方的副本还没复制完，正在替对方复制…' }),
      );
      this.setData({ message: `已删掉 ${removed} 条。` });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
