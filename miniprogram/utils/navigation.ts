/** 真正返回上一页；从分享或二维码直达时替换为目标页。 */
export function returnTo(fallback: string): void {
  if (typeof getCurrentPages === 'function' && getCurrentPages().length > 1) {
    wx.navigateBack({ delta: 1, fail: () => wx.redirectTo({ url: fallback }) });
  } else wx.redirectTo({ url: fallback });
}
