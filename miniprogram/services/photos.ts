import { ApiError, callApi, initializeCloud } from './cloud';
import { compressed } from './bills';
import { exifDate } from '../utils/exif';
import { reportWarn } from './log';
import { todayKey } from '../utils/date';

/** 从相册或相机选照片，最多 count 张，返回本地路径。取消返回空数组。 */
export async function pickPhotos(
  count: number,
  /** 要读拍摄日期时用原图：压缩过的图片会丢掉 EXIF。上传前仍然会压缩。 */
  original = false,
): Promise<string[]> {
  if (count <= 0) return [];
  try {
    const result = await wx.chooseMedia({
      count,
      mediaType: ['image'],
      sizeType: original ? ['original'] : ['compressed'],
    });
    return result.tempFiles.map((file) => file.tempFilePath);
  } catch {
    return [];
  }
}

/** 读拍摄日期的结果：date 读到了就是日期，note 是读不到时要告诉用户的原因。 */
export interface PhotoDate {
  date: string;
  note: string;
}

/** 这些照片里最早的拍摄日期（只读文件开头 64KB）；读不到时 note 说明原因，日期让人自己选。 */
export async function photoDate(paths: string[]): Promise<PhotoDate> {
  const today = todayKey();
  const dates: string[] = [];
  let note = '';
  const fs = wx.getFileSystemManager();
  for (const filePath of paths) {
    const data = await new Promise<ArrayBuffer | null>((resolve) =>
      fs.readFile({
        filePath,
        position: 0,
        length: 65536,
        success: (res) => resolve(res.data as ArrayBuffer),
        fail: () => resolve(null),
      }),
    );
    if (!data) {
      note = '没能读到这张照片的信息，日期请自己选一下。';
      continue;
    }
    const date = exifDate(data);
    if (date >= '1990-01-01' && date <= today) {
      dates.push(date);
      continue;
    }
    const head = new Uint8Array(data.slice(0, 12));
    const jpeg = head[0] === 0xff && head[1] === 0xd8;
    note = jpeg
      ? '这张照片里没有拍摄日期（微信选图时可能被去掉了），日期请自己选一下。'
      : '这张照片不是 JPEG 格式，读不到拍摄日期，日期请自己选一下。';
    reportWarn('photo-date', {
      code: jpeg ? 'NO_EXIF' : 'NOT_JPEG',
      message: Array.from(head)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
    });
  }
  return { date: dates.sort()[0] || '', note: dates.length ? '' : note };
}

/** 上传一张到「wish-photos/小家/」下，返回 fileID。 */
export async function uploadWishPhoto(
  householdId: string,
  path: string,
  index: number,
): Promise<string> {
  initializeCloud();
  try {
    const uploaded = await wx.cloud.uploadFile({
      cloudPath: `wish-photos/${householdId}/${Date.now()}-${index}.jpg`,
      filePath: await compressed(path),
    });
    return uploaded.fileID;
  } catch {
    throw new ApiError('照片没传上去，网络好一点再试试。', 'NETWORK');
  }
}

/** 没保存成功时，把刚传上去的照片删掉，免得留在云里。 */
export function discardPhotos(fileIds: string[]): void {
  if (!fileIds.length) return;
  initializeCloud();
  wx.cloud.deleteFile({ fileList: fileIds }).catch(() => undefined);
}

const cache: Record<string, string> = {};

/**
 * fileID → 可显示的临时地址。先用小程序自己取；对方传的照片可能没权限，
 * 剩下的交给云端换。拿不到的不在结果里（界面不显示）。
 */
export async function photoUrls(
  fileIds: string[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const missing: string[] = [];
  for (const id of fileIds)
    if (cache[id]) result[id] = cache[id];
    else missing.push(id);
  if (!missing.length) return result;
  initializeCloud();
  let rest = missing;
  try {
    const got = await wx.cloud.getTempFileURL({ fileList: missing });
    rest = [];
    for (const item of got.fileList)
      if (item.tempFileURL) result[item.fileID] = item.tempFileURL;
      else rest.push(item.fileID);
  } catch {
    rest = missing;
  }
  if (rest.length) {
    try {
      const got = await callApi<{ urls: Record<string, string> }>(
        'photo.urls',
        { ids: rest },
      );
      Object.assign(result, got.urls);
    } catch {
      // 取不到就不显示，不挡住别的内容。
    }
  }
  Object.assign(cache, result);
  return result;
}
