import type { Household, Todo, TodoKind, TodoWho } from '../../models';
import {
  byPartner,
  memberNames,
  requireHousehold,
} from '../../services/household';
import {
  addTodo,
  clearDone,
  listTodos,
  updateTodo,
} from '../../services/todos';
import { errorMessage } from '../../services/cloud';
import { LENGTHS, TODO_KINDS } from '../../config/options';
import { confirmAction } from '../../utils/confirm';

type Row = Todo & { subText: string };

let loadVersion = 0;
let household: Household | null = null;

function toRow(todo: Todo): Row {
  if (!household) return { ...todo, subText: '' };
  const names = memberNames(household);
  const who = todo.who === 'both' ? '一起' : names[todo.who];
  const by = byPartner(todo.byRole, household, '添加');
  return { ...todo, subText: by ? `${who} · ${by}` : who };
}

Page({
  data: {
    limits: LENGTHS,
    kinds: TODO_KINDS,
    kind: 'shop' as TodoKind,
    names: { a: '', b: '' },
    all: [] as Row[],
    open: [] as Row[],
    done: [] as Row[],
    // 正在保存勾选状态的条目；各条互不阻塞。
    pending: {} as Record<string, boolean>,
    text: '',
    who: 'both' as TodoWho,
    loading: true,
    busy: false,
    error: '',
  },
  onShow() {
    void this.load();
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
      this.setData({ names: memberNames(household), all: todos.map(toRow) });
      this.filter();
    } catch (error) {
      if (version === loadVersion) this.setData({ error: errorMessage(error) });
    } finally {
      if (version === loadVersion) this.setData({ loading: false });
    }
  },
  filter() {
    const items = this.data.all.filter((todo) => todo.kind === this.data.kind);
    this.setData({
      open: items.filter((todo) => !todo.done),
      done: items.filter((todo) => todo.done),
    });
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
  chooseWho(event: WechatMiniprogram.TouchEvent) {
    this.setData({ who: event.currentTarget.dataset.value as TodoWho });
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
        who: this.data.who,
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
  async more() {
    const label = TODO_KINDS.find(
      (item) => item.value === this.data.kind,
    )?.label;
    const count = this.data.done.length;
    try {
      await wx.showActionSheet({
        itemList: [`清除已完成的${label}（${count} 条）`],
      });
    } catch {
      return; // 点了取消
    }
    if (!count) {
      wx.showToast({ title: '没有已完成的条目', icon: 'none' });
      return;
    }
    if (
      !(await confirmAction(
        `清除 ${count} 条已完成的${label}？`,
        '清除后无法恢复。',
      ))
    )
      return;
    this.setData({ busy: true, error: '' });
    try {
      await clearDone(this.data.kind);
      this.setData({
        all: this.data.all.filter(
          (item) => !(item.kind === this.data.kind && item.done),
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
