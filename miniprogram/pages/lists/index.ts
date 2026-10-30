import type { Household, Todo, TodoKind } from '../../models';
import { memberNames, peekHousehold } from '../../services/household';
import { todoService } from '../../services/collections';
import { needsReload } from '../../services/snapshot';
import { createLoader } from '../../services/page-load';
import { errorMessage } from '../../services/cloud';
import {
  LENGTHS,
  TODO_KINDS,
  repeatLabel,
  todoTab,
} from '../../config/options';
import { todayKey } from '../../utils/date';
import { confirmAction } from '../../utils/confirm';
import { applyTheme, themeData } from '../../services/theme';
import {
  agreedToAiText,
  splitTodos,
  type SplitItem,
} from '../../services/assist';

type Row = Todo & {
  whoName: string;
  /** 重复任务：每天 / 每周 / 每月，不重复为空。 */
  repeatText: string;
  /** 还没到时间的重复任务：几月几日再做。 */
  dueText: string;
};

const loader = createLoader();
let household: Household | null = null;

/** 默认「一起」不显示；指定了某个人才在行尾显示名字。 */
function toRow(todo: Todo): Row {
  const extra = {
    repeatText: repeatLabel(todo.repeat),
    dueText: todo.dueOn
      ? `${Number(todo.dueOn.slice(5, 7))}月${Number(todo.dueOn.slice(8))}日再做`
      : '',
  };
  if (!household || todo.who === 'both')
    return { ...todo, ...extra, whoName: '' };
  return { ...todo, ...extra, whoName: memberNames(household)[todo.who] };
}

Page({
  data: {
    ...themeData(),
    limits: LENGTHS,
    kinds: TODO_KINDS,
    kind: 'shop' as TodoKind,
    all: [] as Row[],
    open: [] as Row[],
    // 重复任务生成的下一条，到了日子才进「要做的」。
    later: [] as Row[],
    showLater: false,
    done: [] as Row[],
    // 购物：买过的（去重、清单里已有的不再显示），点一下重新加入。
    bought: [] as Row[],
    showDone: false,
    // 正在保存勾选状态的条目；各条互不阻塞。
    pending: {} as Record<string, boolean>,
    text: '',
    // 喵喵拆出来的条目，勾选后才加进清单。
    split: [] as (SplitItem & { on: boolean })[],
    splitting: false,
    loading: true,
    busy: false,
    error: '',
  },
  onShow() {
    applyTheme(this);
    if (!this.data.all.length) this.showSnapshot();
    if (needsReload('todos')) void this.load();
  },
  /** 冷启动：先显示上次存在本机的清单，云端读完再替换。 */
  showSnapshot() {
    const saved = todoService.peek();
    household = peekHousehold();
    if (!saved || !household) return;
    this.setData({ all: saved.map(toRow) });
    this.filter();
  },
  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },
  load(force = false) {
    return loader(this, {
      key: 'todos',
      force,
      fetch: () => todoService.list(),
      show: (todos, current) => {
        household = current;
        this.setData({ all: todos.map(toRow) });
        this.filter();
      },
    });
  },
  filter() {
    const items = this.data.all.filter(
      (todo) => todoTab(todo.kind) === this.data.kind,
    );
    const today = todayKey();
    const pending = items.filter((todo) => !todo.done);
    const open = pending.filter((todo) => !todo.dueOn || todo.dueOn <= today);
    const later = pending
      .filter((todo) => todo.dueOn && todo.dueOn > today)
      .sort((a, b) => String(a.dueOn).localeCompare(String(b.dueOn)));
    const done = items.filter((todo) => todo.done);
    const seen = new Set(open.map((todo) => todo.text));
    const bought = done.filter((todo) => {
      if (seen.has(todo.text)) return false;
      seen.add(todo.text);
      return true;
    });
    this.setData({ open, later, done, bought });
  },
  replace(id: string, row: Row | null) {
    this.setData({
      all: row
        ? this.data.all.map((item) => (item.id === id ? row : item))
        : this.data.all.filter((item) => item.id !== id),
    });
    this.filter();
  },
  chooseKind(event: WechatMiniprogram.TouchEvent) {
    this.setData({ kind: event.currentTarget.dataset.value as TodoKind });
    this.filter();
  },
  toggleLater() {
    this.setData({ showLater: !this.data.showLater });
  },
  toggleDone() {
    this.setData({ showDone: !this.data.showDone });
  },
  inputText(event: WechatMiniprogram.Input) {
    this.setData({ text: event.detail.value });
  },
  async add() {
    const text = this.data.text.trim();
    if (this.data.busy) return;
    if (!text) {
      this.setData({ error: '先写点什么吧。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      const todo = await todoService.add({
        text,
        kind: this.data.kind,
        who: 'both',
      });
      this.setData({ text: '', all: [toRow(todo), ...this.data.all] });
      this.filter();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  /** 一句话拆成多条：先给你看，勾选后才加。 */
  async splitText() {
    const text = this.data.text.trim();
    if (this.data.splitting || this.data.busy) return;
    if (text.length < 2) {
      this.setData({ error: '先写下要买或要做的事。' });
      return;
    }
    if (!(await agreedToAiText())) return;
    this.setData({ splitting: true, error: '', split: [] });
    try {
      const { items } = await splitTodos(text);
      this.setData({ split: items.map((item) => ({ ...item, on: true })) });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ splitting: false });
    }
  },
  toggleSplit(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ [`split[${index}].on`]: !this.data.split[index].on });
  },
  cancelSplit() {
    this.setData({ split: [] });
  },
  async addSplit() {
    const items = this.data.split.filter((item) => item.on);
    if (this.data.busy || !items.length) return;
    this.setData({ busy: true, error: '' });
    const added: Row[] = [];
    try {
      for (const item of items) {
        const todo = await todoService.add({
          text: item.text,
          kind: item.kind,
          who: 'both',
        });
        added.unshift(toRow(todo));
      }
      this.setData({ text: '', split: [] });
      wx.showToast({ title: `加了 ${added.length} 条`, icon: 'success' });
    } catch (error) {
      this.setData({
        error: `加了 ${added.length} 条，后面的没有保存：${errorMessage(error)}`,
        split: this.data.split.slice(added.length),
      });
    } finally {
      this.setData({ all: [...added, ...this.data.all], busy: false });
      this.filter();
    }
  },
  async toggle(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id);
    const current = this.data.all.find((todo) => todo.id === id);
    if (!current || this.data.pending[id]) return;
    // 先在界面上切换，失败再恢复，连续勾选多条不用等待。
    this.setData({ [`pending.${id}`]: true, error: '' });
    this.replace(id, { ...current, done: !current.done });
    try {
      const todo = await todoService.update(id, { done: !current.done });
      this.replace(id, toRow(todo));
      // 重复任务勾完会生成下一条（取消勾选会收回），重新读一遍。
      if (current.repeat) void this.load(true);
    } catch (error) {
      this.replace(id, current);
      this.setData({
        error: `「${current.text}」没有保存：${errorMessage(error)}`,
      });
    } finally {
      this.setData({ [`pending.${id}`]: false });
    }
  },
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/todo-edit/index?id=${event.currentTarget.dataset.id}`,
    });
  },
  async clear() {
    const label = TODO_KINDS.find(
      (item) => item.value === this.data.kind,
    )?.label;
    const count = this.data.done.length;
    if (
      !count ||
      !(await confirmAction(
        `清除 ${count} 条已完成的${label}？`,
        '清除后无法恢复。',
      ))
    )
      return;
    this.setData({ busy: true, error: '' });
    try {
      // 待办里还混着旧的「家务」，一起清掉。
      const kinds = [...new Set(this.data.done.map((todo) => todo.kind))];
      for (const kind of kinds) await todoService.clearDone(kind);
      this.setData({
        all: this.data.all.filter(
          (item) => !(todoTab(item.kind) === this.data.kind && item.done),
        ),
      });
      this.filter();
      wx.showToast({ title: '已清除', icon: 'success' });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
