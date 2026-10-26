import type { TodoKind, TodoWho } from '../../models';
import { getHousehold, memberNames } from '../../services/household';
import { getTodo, removeTodo, updateTodo } from '../../services/todos';
import { errorMessage } from '../../services/cloud';
import { LENGTHS, TODO_KINDS, todoTab } from '../../config/options';
import { confirmAction } from '../../utils/confirm';

Page({
  data: {
    limits: LENGTHS,
    id: '',
    kinds: TODO_KINDS,
    names: { a: '', b: '' },
    text: '',
    kind: 'shop' as TodoKind,
    who: 'both' as TodoWho,
    busy: false,
    error: '',
  },
  async onLoad(options: Record<string, string | undefined>) {
    if (!options.id) {
      this.setData({ error: '没有找到这条内容，请返回刷新后重试。' });
      return;
    }
    try {
      const todo = await getTodo(options.id);
      this.setData({
        id: todo.id,
        text: todo.text,
        kind: todoTab(todo.kind),
        who: todo.who,
      });
      const household = await getHousehold();
      if (household) this.setData({ names: memberNames(household) });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    }
  },
  inputText(event: WechatMiniprogram.Input) {
    this.setData({ text: event.detail.value });
  },
  choose(event: WechatMiniprogram.TouchEvent) {
    const { field, value } = event.currentTarget.dataset as {
      field: 'kind' | 'who';
      value: string;
    };
    this.setData({ [field]: value });
  },
  async save() {
    if (this.data.busy || !this.data.id) return;
    const text = this.data.text.trim();
    if (!text) {
      this.setData({ error: '内容不能为空。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      await updateTodo(this.data.id, {
        text,
        kind: this.data.kind,
        who: this.data.who,
      });
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  async remove() {
    if (this.data.busy || !this.data.id) return;
    if (!(await confirmAction('删除这条？', '删除后无法恢复。'))) return;
    this.setData({ busy: true, error: '' });
    try {
      await removeTodo(this.data.id);
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
