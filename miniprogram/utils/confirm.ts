/** 删除等操作的二次确认；用户点取消返回 false。 */
export async function confirmAction(
  title: string,
  content: string,
): Promise<boolean> {
  const result = await wx.showModal({
    title,
    content,
    confirmText: '确定',
    confirmColor: '#783e3c',
  });
  return result.confirm;
}
