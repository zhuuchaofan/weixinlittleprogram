/**
 * 保存、删除之后的统一反馈（docs/DESIGN.md「10. 保存、删除、返回」）：
 * 轻提示一下，稍等片刻自动回上一页；等的这会儿页面还是 busy，按钮点不了第二次。
 */
const BACK_DELAY_MS = 600;

/** 编辑页保存或删除成功：提示后回上一页。在 try 里 await，busy 会保持到返回。 */
export function doneBack(title = '已保存'): Promise<void> {
  wx.showToast({ title, icon: 'success' });
  return new Promise((resolve) =>
    setTimeout(() => {
      wx.navigateBack();
      resolve();
    }, BACK_DELAY_MS),
  );
}

/** 留在本页的保存（设置、预算这类）：只提示。 */
export function doneStay(title = '已保存'): void {
  wx.showToast({ title, icon: 'success' });
}
