import type { TodoKind, TodoRepeat, TodoWho } from '../../models';
import { getHousehold, memberNames } from '../../services/household';
import { todoService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import {
  LENGTHS,
  TODO_KINDS,
  TODO_REPEATS,
  todoTab,
} from '../../config/options';
import { confirmAction } from '../../utils/confirm';
import { applyTheme, themeData } from '../../services/theme';

Page({
  data: {
    ...themeData(),
    limits: LENGTHS,
    id: '',
    kinds: TODO_KINDS,
    repeats: TODO_REPEATS,
    repeat: '' as TodoRepeat,
    names: { a: '', b: '' },
    text: '',
    kind: 'shop' as TodoKind,
    who: 'both' as TodoWho,
    busy: false,
    error: '',
  },
  onShow() {
    applyTheme(this);
  },
  async onLoad(options: Record<string, string | undefined>) {
    if (!options.id) {
      this.setData({ error: '这条好像已经不在了，返回刷新一下看看吧。' });
      return;
    }
    try {
      const todo = await todoService.get(options.id);
      this.setData({
        id: todo.id,
        text: todo.text,
        kind: todoTab(todo.kind),
        who: todo.who,
        repeat: todo.repeat || '',
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
      field: 'kind' | 'who' | 'repeat';
      value: string;
    };
    this.setData({ [field]: value });
  },
  async save() {
    if (this.data.busy || !this.data.id) return;
    const text = this.data.text.trim();
    if (!text) {
      this.setData({ error: '还没写内容哦。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      await todoService.update(this.data.id, {
        text,
        kind: this.data.kind,
        who: this.data.who,
        // 购物不重复。
        repeat: this.data.kind === 'todo' ? this.data.repeat : '',
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
      await todoService.remove(this.data.id);
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
