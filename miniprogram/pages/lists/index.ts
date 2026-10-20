import type { Todo, TodoKind, TodoWho } from '../../models';
import { requireHousehold, memberNames } from '../../services/household';
import { addTodo, listTodos, updateTodo } from '../../services/todos';
import { errorMessage } from '../../services/cloud';
import { TODO_KINDS } from '../../config/options';

type Row = Todo & { whoText: string };

let loadVersion = 0;

function whoText(who: TodoWho, names: { a: string; b: string }): string {
  return who === 'both' ? '一起' : names[who];
}

Page({
  data: {
    kinds: TODO_KINDS,
    kind: 'shop' as TodoKind,
    names: { a: '', b: '' },
    myRole: 'a' as 'a' | 'b',
    all: [] as Row[],
    open: [] as Row[],
    done: [] as Row[],
    text: '',
    who: 'both' as TodoWho,
    loading: true,
    busy: false,
    error: '',
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
      const names = memberNames(household);
      const todos = await listTodos();
      if (version !== loadVersion) return;
      this.setData({
        names,
        myRole: household.myRole,
        all: todos.map((todo) => ({
          ...todo,
          whoText: whoText(todo.who, names),
        })),
      });
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
      this.setData({
        text: '',
        all: [
          { ...todo, whoText: whoText(todo.who, this.data.names) },
          ...this.data.all,
        ],
      });
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
    if (!current || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const todo = await updateTodo(id, { done: !current.done });
      this.setData({
        all: this.data.all.map((item) =>
          item.id === id
            ? { ...todo, whoText: whoText(todo.who, this.data.names) }
            : item,
        ),
      });
      this.filter();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/todo-edit/index?id=${event.currentTarget.dataset.id}`,
    });
  },
});
