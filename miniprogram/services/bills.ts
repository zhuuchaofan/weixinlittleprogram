import type { BillItem } from '../models';
import { BILL_IMPORT } from '../config/options';
import { ApiError, callApi, initializeCloud } from './cloud';

// 主页或记账页选好的截图，导入页取走后清空。
let pending: string[] = [];

// 第一次用截图记账时说明截图交给谁识别；同意过就记在这台手机上。
const NOTICE_KEY = 'billImportNoticed';

async function agreedToNotice(): Promise<boolean> {
  try {
    if (wx.getStorageSync(NOTICE_KEY)) return true;
  } catch {
    /* 读不到就再问一次 */
  }
  const result = await wx.showModal({
    title: '截图记账说明',
    content:
      '选中的账单截图会临时上传到云存储，交给第三方服务阿里云通义千问识别日期、金额和商户。识别完立即删除截图，识别结果由你逐笔确认后才保存。',
    confirmText: '知道了',
    cancelText: '不用了',
  });
  if (!result.confirm) return false;
  try {
    wx.setStorageSync(NOTICE_KEY, 1);
  } catch {
    /* 存不下次再问 */
  }
  return true;
}

/** 截图记账：从相册选微信 / 支付宝账单列表截图，到导入页识别和确认。 */
export async function pickBillScreenshots(): Promise<void> {
  if (!(await agreedToNotice())) return;
  let paths: string[];
  try {
    const result = await wx.chooseMedia({
      count: BILL_IMPORT.maxImages,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['original'],
    });
    paths = result.tempFiles.map((file) => file.tempFilePath);
  } catch {
    return; // 取消选择
  }
  if (!paths.length) return;
  pending = paths;
  wx.navigateTo({ url: '/pages/bill-import/index' });
}

export function takePendingImages(): string[] {
  const paths = pending;
  pending = [];
  return paths;
}

/** 压缩失败就用原图。 */
async function compressed(path: string): Promise<string> {
  try {
    const result = await wx.compressImage({ src: path, quality: 80 });
    return result.tempFilePath;
  } catch {
    return path;
  }
}

/**
 * 一张截图：上传到云存储 → 取临时链接交给 bill.parse → 无论成败都删掉图片。
 * 截图只在识别期间留在云端。
 */
export async function parseScreenshot(
  path: string,
  index: number,
): Promise<BillItem[]> {
  initializeCloud();
  let fileID = '';
  try {
    try {
      const uploaded = await wx.cloud.uploadFile({
        cloudPath: `bill-screenshots/${Date.now()}-${index}.jpg`,
        filePath: await compressed(path),
      });
      fileID = uploaded.fileID;
      const link = await wx.cloud.getTempFileURL({ fileList: [fileID] });
      const url = link.fileList[0]?.tempFileURL;
      if (!url) throw new Error('no url');
      const result = await callApi<{ items: BillItem[] }>('bill.parse', {
        url,
      });
      return result.items;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('截图上传失败，请检查网络后重试。', 'NETWORK');
    }
  } finally {
    if (fileID)
      wx.cloud.deleteFile({ fileList: [fileID] }).catch(() => undefined);
  }
}

export async function matchBills(items: BillItem[]): Promise<BillItem[]> {
  return (await callApi<{ items: BillItem[] }>('bill.match', { items })).items;
}

/** 确认后保存：付款人和分摊方式由云端定（上传者、自己的）。 */
export function importBills(
  items: Array<
    Pick<BillItem, 'amount' | 'note' | 'cat' | 'date' | 'flow' | 'src'>
  >,
): Promise<{ added: number; skipped: number }> {
  return callApi('expense.addMany', { items });
}
