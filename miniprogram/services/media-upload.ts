import { localConfig } from '../config/local';
import { callCloud } from './cloud';
import {
  inspectImage,
  uploadOriginalImage,
  type ImageUploadState,
} from './image-upload';
import { validateVideo } from './media';
import type { ManagedPhoto } from './photos';

export interface PendingMedia {
  id: string;
  type: 'image' | 'video';
  path: string;
  coverPath: string;
  duration: number;
  width: number;
  height: number;
  size: number;
  status: 'pending' | 'uploading' | 'failed' | 'uploaded' | 'saved';
  progress: number;
  message: string;
  fileID?: string;
  coverID?: string;
  imageUpload?: ImageUploadState;
  coverUpload?: ImageUploadState;
  verified?: boolean;
  media?: ManagedPhoto;
}
let running: Promise<void> = Promise.resolve();
export function waitForMediaUploads(): Promise<void> {
  return running;
}
export function holdMediaUploads(): () => void {
  let finish: () => void = () => {};
  running = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return finish;
}
const recoveryKey = () =>
  'media:pending:v1:' + localConfig.mode + ':' + localConfig.cloudEnvId;
export function rememberUploads(items: PendingMedia[]): void {
  wx.setStorageSync(
    recoveryKey(),
    items.filter((p) => p.status !== 'saved'),
  );
}
export function restoreUploads(): PendingMedia[] {
  const items = wx.getStorageSync(recoveryKey());
  return Array.isArray(items)
    ? items.map((p: PendingMedia) => ({
        ...p,
        status: p.media ? 'uploaded' : 'pending',
        progress: 0,
        message: p.media
          ? '文件已上传，待保存草稿'
          : '待上传；若临时文件失效请移除后重新选择',
      }))
    : [];
}
function saveLocal(path: string): Promise<string> {
  return new Promise((resolve, reject) =>
    wx.getFileSystemManager().saveFile({
      tempFilePath: path,
      success: (r) => resolve(r.savedFilePath),
      fail: reject,
    }),
  );
}
export async function uploadImage(
  path: string,
  requestId: string,
): Promise<string> {
  const state = await inspectImage(path);
  return uploadOriginalImage(
    path,
    requestId,
    state,
    new MediaUploadSession(),
    () => {},
    () => {},
  );
}

interface UploadTicket {
  url: string;
  fileID: string;
  cloudPath: string;
  authorization: string;
  token: string;
  cosFileID: string;
}
export class MediaUploadSession {
  cancelled = false;
  task: WechatMiniprogram.UploadTask | null = null;
  cancel() {
    this.cancelled = true;
    this.task?.abort();
  }
  check() {
    if (this.cancelled) throw new Error('上传已暂停，可返回后重试。');
  }
  async uploadImage(
    item: PendingMedia,
    cover: boolean,
    update: () => void,
  ): Promise<string> {
    const key = cover ? 'coverUpload' : 'imageUpload';
    const fileKey = cover ? 'coverID' : 'fileID';
    // 旧版已成功上传的文件可直接复用，不会重新编码历史照片。
    if (item[fileKey] && !item[key]) return item[fileKey]!;
    this.check();
    const state =
      item[key] || (await inspectImage(cover ? item.coverPath : item.path));
    this.check();
    item[key] = state;
    if (!cover) {
      item.width = state.width;
      item.height = state.height;
      item.size = state.size;
    }
    const changed = () => {
      if (state.fileID) item[fileKey] = state.fileID;
      update();
    };
    changed();
    return uploadOriginalImage(
      cover ? item.coverPath : item.path,
      item.id + (cover ? '-cover' : ''),
      state,
      this,
      changed,
      (value) => {
        item.progress = value;
        update();
      },
    );
  }
  async uploadVideo(item: PendingMedia, update: () => void): Promise<string> {
    validateVideo(item);
    this.check();
    if (String(localConfig.mode) === 'mock')
      return item.fileID || saveLocal(item.path);
    const payload = {
      requestId: item.id,
      size: item.size,
      duration: item.duration,
      width: item.width,
      height: item.height,
    };
    if (!item.fileID) {
      const ticket = await callCloud<UploadTicket>(
        'prepareVideoUpload',
        payload,
      );
      this.check();
      await new Promise<void>((resolve, reject) => {
        this.task = wx.uploadFile({
          url: ticket.url,
          filePath: item.path,
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
                  new Error('视频上传未成功，请检查网络及上传域名配置后重试。'),
                ),
          fail: () =>
            reject(
              new Error(
                this.cancelled
                  ? '上传已暂停，可重试。'
                  : '视频上传中断或超时，请检查网络后重试。',
              ),
            ),
        });
        this.task.onProgressUpdate((r) => {
          item.progress = Math.min(99, r.progress);
          update();
        });
      });
      this.task = null;
      item.fileID = ticket.fileID;
      update();
    }
    this.check();
    if (!item.verified) {
      item.message = '上传完成，正在校验视频…';
      update();
      await callCloud('verifyVideoUpload', payload);
      item.verified = true;
      update();
    }
    return item.fileID;
  }
}
export async function uploadMedia(
  item: PendingMedia,
  session: MediaUploadSession,
  update: () => void,
): Promise<ManagedPhoto> {
  session.check();
  if (item.media) return item.media;
  if (item.type === 'video') {
    item.fileID = await session.uploadVideo(item, update);
    update();
    session.check();
    if (
      item.coverPath &&
      (!item.coverID || (item.coverUpload && !item.coverUpload.verified))
    ) {
      item.message = '正在上传视频封面…';
      update();
      item.coverID = await session.uploadImage(item, true, update);
      update();
    }
  } else {
    item.fileID = await session.uploadImage(item, false, update);
    update();
  }
  session.check();
  const original = item.fileID || '';
  item.media = {
    id: item.id,
    type: item.type,
    ...(item.type === 'image' ? { category: 'pending' as const } : {}),
    visibility: 'public',
    url: original,
    original,
    thumbnail: item.type === 'video' ? item.coverID || '' : original,
    caption: '',
    placements: [],
    placeholder: false,
    ratio:
      item.width === item.height
        ? 'square'
        : item.width > item.height
          ? 'landscape'
          : 'portrait',
    ...(item.type === 'video'
      ? {
          coverUrl: item.coverID || '',
          duration: item.duration,
          width: item.width,
          height: item.height,
          size: item.size,
        }
      : {}),
  };
  update();
  return item.media;
}
