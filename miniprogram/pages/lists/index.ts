import type { Household, Todo, TodoKind } from '../../models';
import {
  memberNames,
  peekHousehold,
  requireHousehold,
} from '../../services/household';
import {
  addTodo,
  clearDone,
  listTodos,
  peekTodos,
  updateTodo,
} from '../../services/todos';
import { markLoaded, needsReload } from '../../services/snapshot';
import { errorMessage } from '../../services/cloud';
import { LENGTHS, TODO_KINDS, todoTab } from '../../config/options';
import { confirmAction } from '../../utils/confirm';

type Row = Todo & { whoName: string };

let loadVersion = 0;
let household: Household | null = null;

/** 默认「一起」不显示；指定了某个人才在行尾显示名字。 */
function toRow(todo: Todo): Row {
  if (!household || todo.who === 'both') return { ...todo, whoName: '' };
  return { ...todo, whoName: memberNames(household)[todo.who] };
}

Page({
  data: {
    limits: LENGTHS,
    kinds: TODO_KINDS,
    kind: 'shop' as TodoKind,
    all: [] as Row[],
    open: [] as Row[],
    done: [] as Row[],
    // 购物：买过的（去重、清单里已有的不再显示），点一下重新加入。
    bought: [] as Row[],
    showDone: false,
    // 正在保存勾选状态的条目；各条互不阻塞。
    pending: {} as Record<string, boolean>,
    text: '',
    loading: true,
    busy: false,
    error: '',
  },
  onShow() {
    if (!this.data.all.length) this.showSnapshot();
    if (needsReload('todos')) void this.load();
  },
  /** 冷启动：先显示上次存在本机的清单，云端读完再替换。 */
  showSnapshot() {
    const saved = peekTodos();
    household = peekHousehold();
    if (!saved || !household) return;
    this.setData({ all: saved.map(toRow) });
    this.filter();
  },
  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },
  async load(force = false) {
    const version = ++loadVersion;
    this.setData({ loading: true, error: '' });
    try {
      household = await requireHousehold(force === true);
      if (!household) return;
      const todos = await listTodos();
      if (version !== loadVersion) return;
      this.setData({ all: todos.map(toRow) });
      this.filter();
      markLoaded('todos');
    } catch (error) {
      if (version === loadVersion) this.setData({ error: errorMessage(error) });
    } finally {
      if (version === loadVersion) this.setData({ loading: false });
    }
  },
  filter() {
    const items = this.data.all.filter(
      (todo) => todoTab(todo.kind) === this.data.kind,
    );
    const open = items.filter((todo) => !todo.done);
    const done = items.filter((todo) => todo.done);
    const seen = new Set(open.map((todo) => todo.text));
    const bought = done.filter((todo) => {
      if (seen.has(todo.text)) return false;
      seen.add(todo.text);
      return true;
    });
    this.setData({ open, done, bought });
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
      this.setData({ error: '请先写下内容。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      const todo = await addTodo({
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
  async toggle(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id);
    const current = this.data.all.find((todo) => todo.id === id);
    if (!current || this.data.pending[id]) return;
    // 先在界面上切换，失败再恢复，连续勾选多条不用等待。
    this.setData({ [`pending.${id}`]: true, error: '' });
    this.replace(id, { ...current, done: !current.done });
    try {
      const todo = await updateTodo(id, { done: !current.done });
      this.replace(id, toRow(todo));
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
      for (const kind of kinds) await clearDone(kind);
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
