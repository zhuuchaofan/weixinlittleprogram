// 弹窗按钮的颜色只能写色值，和 app.wxss 的 --danger 保持一致。
const DANGER = '#a1302a';

/**
 * 二次确认；用户点取消返回 false。
 * confirmText 写动作本身（「删除」「清除」「退出」），不写「确定」，最多 4 个字（微信的限制）。
 * 删不回来的操作按钮是红字；不是删除类的（记为已结算）传 danger = false。
 */
export async function confirmAction(
  title: string,
  content: string,
  confirmText = '删除',
  danger = true,
): Promise<boolean> {
  const result = await wx.showModal({
    title,
    content,
    confirmText,
    cancelText: '再想想',
    ...(danger ? { confirmColor: DANGER } : {}),
  });
  return result.confirm;
}
