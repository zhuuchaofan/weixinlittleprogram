import { localConfig } from '../config/local';
import { callCloud } from './cloud';

// 文件直传的应用上限；与云端保持一致，不通过缩小照片迎合请求体限制。
export const IMAGE_SIZE_LIMIT = 30 * 1024 * 1024;
export type ImageFormat = 'jpg' | 'png' | 'webp';
export interface ImageUploadState {
  size: number;
  format: ImageFormat;
  width: number;
  height: number;
  fileID?: string;
  verified?: boolean;
}
interface UploadControl {
  cancelled: boolean;
  task: WechatMiniprogram.UploadTask | null;
  check(): void;
}
interface ImageTicket {
  url: string;
  fileID: string;
  cloudPath: string;
  authorization: string;
  token: string;
  cosFileID: string;
}

/** 仅读取文件信息和 16 字节文件头，不编码 Base64、不压缩、不改写源文件。 */
export async function inspectImage(path: string): Promise<ImageUploadState> {
  try {
    const size = await new Promise<number>((resolve, reject) =>
      wx.getFileSystemManager().getFileInfo({
        filePath: path,
        success: (r) => resolve(r.size),
        fail: reject,
      }),
    );
    if (!Number.isFinite(size) || size <= 0 || size > IMAGE_SIZE_LIMIT)
      throw new Error('照片需在 30 MB 以内；原文件不会被自动压缩。');
    const header = await new Promise<ArrayBuffer>((resolve, reject) =>
      wx.getFileSystemManager().readFile({
        filePath: path,
        position: 0,
        length: 16,
        success: (r) => resolve(r.data as ArrayBuffer),
        fail: reject,
      }),
    );
    const bytes = new Uint8Array(header);
    const ascii = (start: number, end: number) =>
      String.fromCharCode(...bytes.slice(start, end));
    const format: ImageFormat | null =
      bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'jpg'
        : [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
          ? 'png'
          : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
            ? 'webp'
            : null;
    if (!format)
      throw new Error(
        '请选择 JPG、PNG 或 WebP 图片；其他格式请先导出为兼容格式。',
      );
    const info = await wx.getImageInfo({ src: path });
    if (!(info.width > 0 && info.height > 0))
      throw new Error('无法读取图片尺寸，请重新选择。');
    return { size, format, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('无法读取照片，临时文件可能已失效，请重新选择。');
  }
}

/** 上传完成就持久化 fileID；校验失败时重试校验，不重复传输文件。 */
export async function uploadOriginalImage(
  path: string,
  requestId: string,
  state: ImageUploadState,
  control: UploadControl,
  update: () => void,
  progress: (value: number) => void,
): Promise<string> {
  control.check();
  const payload = { requestId, size: state.size, format: state.format };
  if (!state.fileID) {
    if (String(localConfig.mode) === 'mock') {
      state.fileID = await new Promise<string>((resolve, reject) =>
        wx.getFileSystemManager().saveFile({
          tempFilePath: path,
          success: (r) => resolve(r.savedFilePath),
          fail: reject,
        }),
      );
    } else {
      const ticket = await callCloud<ImageTicket>(
        'prepareImageUpload',
        payload,
      );
      control.check();
      if (!/^https:\/\//.test(ticket.url) || !ticket.fileID)
        throw new Error('图片上传凭据无效，请检查云函数部署。');
      try {
        await new Promise<void>((resolve, reject) => {
          control.task = wx.uploadFile({
            url: ticket.url,
            filePath: path,
            name: 'file',
            timeout: 120000,
            formData: {
              key: ticket.cloudPath,
              Signature: ticket.authorization,
              'x-cos-security-token': ticket.token,
              'x-cos-meta-fileid': ticket.cosFileID,
            },
            success: (r) =>
              r.statusCode >= 200 &&
              r.statusCode < 300 &&
              !/<Error[>\s]/.test(r.data)
                ? resolve()
                : reject(
                    new Error(
                      '图片上传未成功，请检查网络及上传域名配置后重试。',
                    ),
                  ),
            fail: () =>
              reject(
                new Error(
                  control.cancelled
                    ? '上传已暂停，可重试。'
                    : '图片上传中断或超时，请检查网络后重试。',
                ),
              ),
          });
          control.task.onProgressUpdate((r) =>
            progress(Math.min(99, r.progress)),
          );
        });
      } finally {
        control.task = null;
      }
      state.fileID = ticket.fileID;
    }
    update();
  }
  control.check();
  if (!state.verified) {
    if (String(localConfig.mode) !== 'mock') {
      const result = await callCloud<{ fileID: string }>(
        'verifyImageUpload',
        payload,
      );
      if (result.fileID !== state.fileID)
        throw new Error('图片校验结果不匹配，请重试。');
    }
    state.verified = true;
    update();
  }
  control.check();
  return state.fileID;
}
