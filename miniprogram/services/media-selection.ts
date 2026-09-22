import { validateVideo } from './media';
import type { PendingMedia } from './media-upload';

/** 顺序读取选择结果；保留逐项失败、数量裁剪及 iOS 元数据回退行为。 */
export async function prepareSelectedMedia(
  files: WechatMiniprogram.ChooseMediaSuccessCallbackResult['tempFiles'],
  type: 'image' | 'video',
  remaining: number,
): Promise<{ chosen: PendingMedia[]; failures: string[] }> {
  const chosen: PendingMedia[] = [];
  const failures: string[] = [];
  for (const [index, file] of files.slice(0, remaining).entries()) {
    try {
      let info: WechatMiniprogram.GetVideoInfoSuccessCallbackResult | null =
        null;
      if (type === 'video') {
        try {
          info = await wx.getVideoInfo({ src: file.tempFilePath });
        } catch {
          info = null;
        }
      }
      const item: PendingMedia = {
        id:
          'media-' +
          Date.now() +
          '-' +
          index +
          '-' +
          Math.random().toString(36).slice(2, 10),
        type,
        path: file.tempFilePath,
        coverPath: file.thumbTempFilePath || '',
        size: file.size,
        // iOS 的 chooseMedia 已提供元数据；部分本地临时视频用
        // getVideoInfo 读取会返回空值，因此优先采用选择结果。
        duration: file.duration || info?.duration || 0,
        width: file.width || info?.width || 0,
        height: file.height || info?.height || 0,
        status: 'pending',
        progress: 0,
        message: '待上传',
      };
      if (type === 'video') validateVideo(item);
      chosen.push(item);
    } catch (error) {
      failures.push(
        error instanceof Error
          ? error.message
          : '无法读取视频，请选择 MP4 或 MOV 文件。',
      );
    }
  }
  return { chosen, failures };
}
