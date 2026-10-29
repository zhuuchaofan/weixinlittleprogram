import type { Household } from '../models';
import { errorMessage } from './cloud';
import { requireHousehold } from './household';
import { markLoaded } from './snapshot';

type LoadingPage = {
  setData(data: Record<string, unknown>): void;
};

/**
 * 各页共用的读取流程：转圈 → 确认小家（没有时去欢迎页）→ 读云端 → 显示 → 记下读过（见 snapshot.ts）。
 * 每页建一个；连续发起时只认最后一次，先发起的晚到了直接丢掉。出错写进 data.error。
 */
export function createLoader() {
  let version = 0;
  return async function load<T>(
    page: LoadingPage,
    options: {
      /** needsReload / markLoaded 用的名字。 */
      key: string;
      /** 下拉刷新时为 true：重新读小家，不用缓存。 */
      force: boolean;
      fetch: (household: Household) => Promise<T>;
      show: (data: T, household: Household) => void;
    },
  ): Promise<void> {
    const current = ++version;
    page.setData({ loading: true, error: '' });
    try {
      const household = await requireHousehold(options.force);
      if (!household) return;
      const data = await options.fetch(household);
      if (current !== version) return;
      options.show(data, household);
      markLoaded(options.key);
    } catch (error) {
      if (current === version) page.setData({ error: errorMessage(error) });
    } finally {
      if (current === version) page.setData({ loading: false });
    }
  };
}

/**
 * 不走小家列表流程的页面（设置、会员、退出小家这类每次都读最新的）共用的读取外壳：
 * 转圈 → 执行 → 出错写进 data.error → 收起转圈。task 里自己处理"没有小家"之类的跳转。
 */
export async function withLoading(
  page: LoadingPage,
  task: () => Promise<void>,
): Promise<void> {
  page.setData({ loading: true, error: '' });
  try {
    await task();
  } catch (error) {
    page.setData({ error: errorMessage(error) });
  } finally {
    page.setData({ loading: false });
  }
}
