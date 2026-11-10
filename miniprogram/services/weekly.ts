import type { WeeklyStatus } from '../models';
import { callApi } from './cloud';

/** 公众平台「记账周报通知」一次性订阅消息模板，和云端 weekly.js 的 TEMPLATE_ID 一致。 */
export const WEEKLY_TEMPLATE = 'vsDp7r72wFcsDI3dn3ChPDN_u-6Yy3QJuMLd2jGvZOI';

/**
 * accept：点了允许；reject：点了取消；off：微信设置里关掉了订阅消息（或这条被关了）；
 * fail：没弹出来（基础库太旧、网络等）。
 */
export type WeeklyAnswer = 'accept' | 'reject' | 'off' | 'fail';

/**
 * 弹微信的订阅窗口。必须在点按的回调里第一个调用（前面不能 await 别的），否则微信不弹。
 * 一次性订阅：点一次「允许」，云端可以发一条。
 */
export function askWeekly(): Promise<WeeklyAnswer> {
  return new Promise((resolve) => {
    if (!wx.requestSubscribeMessage) {
      resolve('fail');
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [WEEKLY_TEMPLATE],
      success: (result) => {
        const answer = (result as unknown as Record<string, string>)[
          WEEKLY_TEMPLATE
        ];
        resolve(
          answer === 'accept'
            ? 'accept'
            : answer === 'reject'
              ? 'reject'
              : 'off',
        );
      },
      // 20004：用户在微信「设置 → 通知」里关掉了这个小程序的订阅消息。
      fail: (error) => resolve(error.errCode === 20004 ? 'off' : 'fail'),
    });
  });
}

/** 允许之后告诉云端：次数加 1。 */
export function addWeekly(): Promise<WeeklyStatus> {
  return callApi<WeeklyStatus>('weekly.subscribe');
}

/** 不想收了：次数清零。 */
export function stopWeekly(): Promise<WeeklyStatus> {
  return callApi<WeeklyStatus>('weekly.cancel');
}
