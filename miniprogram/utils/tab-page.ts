import { requireHousehold } from '../services/household';
import { errorMessage } from '../services/cloud';

/** 阶段 1 的占位 tab：只负责确认已加入小家，未加入时跳到创建 / 加入页。 */
export function registerPlaceholderTab(): void {
  Page({
    data: { loading: true, ready: false, error: '' },
    onShow() {
      void this.load();
    },
    retry() {
      void this.load();
    },
    async load() {
      this.setData({ loading: true, error: '' });
      try {
        const household = await requireHousehold();
        this.setData({ ready: !!household });
      } catch (error) {
        this.setData({ error: errorMessage(error) });
      } finally {
        this.setData({ loading: false });
      }
    },
  });
}
