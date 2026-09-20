import { returnTo } from './navigation';

export interface EditorLeaveOptions {
  busy: boolean;
  dirty: boolean;
  fallback: string;
  content: string;
  cancelText: string;
}

export async function leaveEditor(options: EditorLeaveOptions): Promise<void> {
  if (options.busy) return;
  if (options.dirty) {
    const result = await wx.showModal({
      title: '放弃未保存的修改？',
      content: options.content,
      confirmText: '放弃修改',
      cancelText: options.cancelText,
    });
    if (!result.confirm) return;
  }
  wx.disableAlertBeforeUnload?.();
  returnTo(options.fallback);
}

export function setEditorUnloadWarning(dirty: boolean, message: string): void {
  if (dirty) wx.enableAlertBeforeUnload?.({ message });
  else wx.disableAlertBeforeUnload?.();
}
