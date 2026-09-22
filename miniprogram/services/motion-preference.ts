const MOTION_STORAGE_KEY = 'two-cats:motion';

/** 保留历史约定：只有 on 开启动效，其余值均减少动效。 */
export function getReduceMotion(): boolean {
  return wx.getStorageSync(MOTION_STORAGE_KEY) !== 'on';
}

export function setReduceMotion(reduceMotion: boolean): void {
  wx.setStorageSync(MOTION_STORAGE_KEY, reduceMotion ? 'off' : 'on');
}
