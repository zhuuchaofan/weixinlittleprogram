import type { GoalInput } from '../../models';
import { goalService } from '../../services/collections';
import { memberNames, peekHousehold } from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { confirmAction } from '../../utils/confirm';
import { fenToInput, formatYuan, parseYuan } from '../../utils/money';
import { shiftMonth, shortDate, todayKey } from '../../utils/date';
import { LENGTHS } from '../../config/options';
import { applyTheme, themeData } from '../../services/theme';

Page({
  data: {
    ...themeData(),
    limits: LENGTHS,
    id: '',
    title: '',
    targetText: '',
    savedText: '',
    /** 打开时的已存金额：没改就不传，免得盖掉对方刚存的。 */
    savedBefore: '',
    deadline: shiftMonth(todayKey().slice(0, 7), 11),
    minMonth: todayKey().slice(0, 7),
    log: [] as Array<{ key: number; text: string; amountText: string }>,
    busy: false,
    error: '',
  },
  onShow() {
    applyTheme(this);
  },
  async onLoad(options: Record<string, string | undefined>) {
    // 从「想去」点「为它攒钱」进来：名称先填好，只要写金额。
    if (options.title)
      this.setData({
        title: decodeURIComponent(options.title).slice(0, LENGTHS.goalTitle),
      });
    if (!options.id) return;
    let goal;
    try {
      goal = await goalService.get(options.id);
    } catch (error) {
      this.setData({ error: errorMessage(error) });
      return;
    }
    const household = peekHousehold();
    const names = household ? memberNames(household) : { a: '', b: '' };
    const savedText = fenToInput(goal.saved);
    this.setData({
      id: goal.id,
      title: goal.title,
      targetText: fenToInput(goal.target),
      savedText,
      savedBefore: savedText,
      deadline: goal.deadline,
      // 已过截止月的旧目标也要能选回原来的月份。
      minMonth:
        goal.deadline < this.data.minMonth ? goal.deadline : this.data.minMonth,
      log: goal.log.map((entry) => ({
        key: entry.ts,
        text: `${shortDate(entry.date)}${entry.role ? ' · ' + names[entry.role] : ''}`,
        amountText: formatYuan(entry.amount),
      })),
    });
  },
  inputTitle(event: WechatMiniprogram.Input) {
    this.setData({ title: event.detail.value });
  },
  inputTarget(event: WechatMiniprogram.Input) {
    this.setData({ targetText: event.detail.value });
  },
  inputSaved(event: WechatMiniprogram.Input) {
    this.setData({ savedText: event.detail.value });
  },
  pickDeadline(event: WechatMiniprogram.PickerChange) {
    this.setData({ deadline: String(event.detail.value).slice(0, 7) });
  },
  async save() {
    if (this.data.busy) return;
    const title = this.data.title.trim();
    const target = parseYuan(this.data.targetText);
    const savedText = this.data.savedText.trim();
    const saved = savedText ? parseYuan(savedText) : 0;
    if (!title) return this.setData({ error: '请填写目标名称。' });
    if (!target) return this.setData({ error: '请填写目标金额。' });
    if (savedText && !saved && Number(savedText) !== 0)
      return this.setData({ error: '已存金额不对，最多两位小数。' });
    const input: Partial<GoalInput> = {
      title,
      target,
      deadline: this.data.deadline,
    };
    if (!this.data.id || savedText !== this.data.savedBefore)
      input.saved = saved;
    this.setData({ busy: true, error: '' });
    try {
      if (this.data.id) await goalService.update(this.data.id, input);
      else await goalService.add(input as GoalInput);
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  async remove() {
    if (this.data.busy || !this.data.id) return;
    if (
      !(await confirmAction(
        '删除这个目标？',
        '存入记录会一起删除，记账不受影响。删除后无法恢复。',
      ))
    )
      return;
    this.setData({ busy: true, error: '' });
    try {
      await goalService.remove(this.data.id);
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
