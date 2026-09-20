import type { EventProgram, EventProgramItem } from '../../models';
import { checkAdmin } from '../../services/access';
import { eventProgramService } from '../../services/event-program';
import {
  leaveEditor,
  setEditorUnloadWarning,
} from '../../utils/editor-navigation';

function copyProgram(program: EventProgram): EventProgram {
  return JSON.parse(JSON.stringify(program)) as EventProgram;
}

Page({
  data: {
    authorized: false,
    loading: false,
    dirty: false,
    error: '',
    message: '',
    saveState: '正在读取流程草稿…',
    program: eventProgramService.defaultProgram(),
  },
  savedSnapshot: '',
  onLoad() {
    void this.load();
  },
  async back() {
    await leaveEditor({
      busy: this.data.loading,
      dirty: this.data.dirty,
      fallback: '/pages/admin/index',
      content: '当天流程尚未保存，返回会丢失这次修改。',
      cancelText: '继续编辑',
    });
  },
  markDirty() {
    const dirty = JSON.stringify(this.data.program) !== this.savedSnapshot;
    this.setData({
      dirty,
      saveState: dirty
        ? '有未保存的修改'
        : '草稿已保存；亲友看到的是上次发布的内容',
    });
    setEditorUnloadWarning(dirty, '当天流程尚未保存，返回会丢失这次修改。');
  },
  markSaved(published = false) {
    this.savedSnapshot = JSON.stringify(this.data.program);
    this.setData({
      dirty: false,
      saveState: published ? '展示已更新' : '草稿已保存，需更新展示才会发布',
    });
    setEditorUnloadWarning(false, '');
  },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '', message: '' });
    try {
      if (!(await checkAdmin())) throw new Error('仅主人可以管理当天流程');
      const program = await eventProgramService.draft();
      this.setData({ authorized: true, program });
      this.markSaved();
      this.setData({ saveState: '已读取草稿；亲友看到的是上次发布的内容' });
    } catch (error) {
      this.setData({ error: (error as Error).message });
    } finally {
      this.setData({ loading: false });
    }
  },
  updateMeta(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field) as 'title' | 'lead';
    this.setData({
      program: { ...this.data.program, [field]: event.detail.value },
    });
    this.markDirty();
  },
  updateItem(event: WechatMiniprogram.Input) {
    const index = Number(event.currentTarget.dataset.index);
    const field = String(event.currentTarget.dataset.field) as keyof Pick<
      EventProgramItem,
      'title' | 'time' | 'description'
    >;
    const items = this.data.program.items.slice();
    items[index] = { ...items[index], [field]: event.detail.value };
    this.setData({ program: { ...this.data.program, items } });
    this.markDirty();
  },
  toggleItem(event: WechatMiniprogram.SwitchChange) {
    const index = Number(event.currentTarget.dataset.index);
    const items = this.data.program.items.slice();
    items[index] = { ...items[index], visible: event.detail.value };
    this.setData({ program: { ...this.data.program, items } });
    this.markDirty();
  },
  updateBooth(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field) as
      'title' | 'time' | 'description';
    this.setData({
      program: {
        ...this.data.program,
        photoBooth: {
          ...this.data.program.photoBooth,
          [field]: event.detail.value,
        },
      },
    });
    this.markDirty();
  },
  toggleBooth(event: WechatMiniprogram.SwitchChange) {
    this.setData({
      program: {
        ...this.data.program,
        photoBooth: {
          ...this.data.program.photoBooth,
          enabled: event.detail.value,
        },
      },
    });
    this.markDirty();
  },
  addItem() {
    if (this.data.program.items.length >= 20) {
      this.setData({ error: '流程最多保留 20 项。' });
      return;
    }
    this.setData({
      program: {
        ...this.data.program,
        items: [
          ...this.data.program.items,
          {
            id: `program-${Date.now()}`,
            title: '新的环节',
            time: '',
            description: '',
            visible: true,
          },
        ],
      },
    });
    this.markDirty();
  },
  moveItem(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const next = index + Number(event.currentTarget.dataset.delta);
    if (next < 0 || next >= this.data.program.items.length) return;
    const items = this.data.program.items.slice();
    [items[index], items[next]] = [items[next], items[index]];
    this.setData({ program: { ...this.data.program, items } });
    this.markDirty();
  },
  async removeItem(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const result = await wx.showModal({
      title: '移除这个环节？',
      content: '移除后仍可在未保存前继续编辑；保存草稿后才会记录这次修改。',
      confirmText: '移除',
      confirmColor: '#783e3c',
    });
    if (!result.confirm) return;
    this.setData({
      program: {
        ...this.data.program,
        items: this.data.program.items.filter((_, i) => i !== index),
      },
    });
    this.markDirty();
  },
  async restoreDefault() {
    const result = await wx.showModal({
      title: '恢复内置默认流程？',
      content: '会替换当前编辑内容为代码中的默认流程，不会立即影响亲友页面。',
      confirmText: '恢复草稿',
      confirmColor: '#783e3c',
    });
    if (!result.confirm) return;
    this.setData({
      program: copyProgram(eventProgramService.defaultProgram()),
      message: '已恢复内置默认流程，请保存草稿或更新展示。',
    });
    this.markDirty();
  },
  async save() {
    await this.persist(false);
  },
  async publish() {
    const result = await wx.showModal({
      title: '更新亲友看到的流程？',
      content: '当前草稿将替换答谢宴当天首页显示的流程。',
      confirmText: '更新展示',
      confirmColor: '#783e3c',
    });
    if (result.confirm) await this.persist(true);
  },
  async persist(publish: boolean) {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '', message: '' });
    try {
      await (publish
        ? eventProgramService.publish(this.data.program)
        : eventProgramService.save(this.data.program));
      this.markSaved(publish);
      this.setData({
        message: publish
          ? '展示已更新，亲友重新进入首页即可查看。'
          : '草稿已保存。',
      });
    } catch (error) {
      this.setData({ error: (error as Error).message });
    } finally {
      this.setData({ loading: false });
    }
  },
});
