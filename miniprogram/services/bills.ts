import type { BillItem, FileSkipped } from '../models';
import { BILL_IMPORT } from '../config/options';
import { sharedStrings, sheetRows, wechatRows } from '../utils/bill-file';
import { ApiError, callApi, initializeCloud } from './cloud';

// 主页或记账页选好的截图或账单文件，导入页取走后清空。
let pending: string[] = [];
let pendingFile = '';

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

export function takePendingFile(): string {
  const path = pendingFile;
  pendingFile = '';
  return path;
}

/** 记账页、主页的「导入账单」：选截图还是微信账单文件。 */
export async function chooseBillImport(): Promise<void> {
  let tapIndex: number;
  try {
    ({ tapIndex } = await wx.showActionSheet({
      itemList: ['账单截图（AI 识别）', '微信账单文件（Excel）'],
    }));
  } catch {
    return; // 取消
  }
  if (tapIndex === 0) await pickBillScreenshots();
  else await pickBillFile();
}

// 第一次选账单文件时说明怎么拿到文件；看过就记在这台手机上。
const FILE_GUIDE_KEY = 'billFileGuided';

async function readGuide(): Promise<boolean> {
  try {
    if (wx.getStorageSync(FILE_GUIDE_KEY)) return true;
  } catch {
    /* 读不到就再说明一次 */
  }
  const result = await wx.showModal({
    title: '怎么拿到账单文件',
    content:
      '微信：我 → 服务 → 钱包 → 账单 → 右上角「…」→ 下载账单 → 用于个人对账，选好时间，微信会把 Excel 发到聊天里。然后回到这里，从聊天里选这个文件。文件只在手机上读取，不会上传。',
    confirmText: '去选文件',
    cancelText: '先不用',
  });
  if (!result.confirm) return false;
  try {
    wx.setStorageSync(FILE_GUIDE_KEY, 1);
  } catch {
    /* 存不下次再说明 */
  }
  return true;
}

/** 账单文件：从微信聊天里选微信账单 Excel，到导入页读取和确认。 */
export async function pickBillFile(): Promise<void> {
  if (!(await readGuide())) return;
  let path: string;
  try {
    const result = await wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx'],
    });
    path = result.tempFiles[0]?.path || '';
  } catch {
    return; // 取消选择
  }
  if (!path) return;
  pendingFile = path;
  wx.navigateTo({ url: '/pages/bill-import/index?mode=file' });
}

const NOT_WECHAT =
  '没能读懂这个文件，请选微信「下载账单 → 用于个人对账」发来的 Excel。';

/** 在手机上解开 xlsx，读出微信账单的行；临时解压的目录读完就删。 */
function readWechatFile(path: string): Promise<ReturnType<typeof wechatRows>> {
  const fs = wx.getFileSystemManager();
  const dir = `${wx.env.USER_DATA_PATH}/bill-file-${Date.now()}`;
  const read = (name: string) =>
    new Promise<string>((resolve, reject) =>
      fs.readFile({
        filePath: `${dir}/${name}`,
        encoding: 'utf8',
        success: (result) => resolve(String(result.data)),
        fail: reject,
      }),
    );
  return new Promise<void>((resolve, reject) =>
    fs.unzip({
      zipFilePath: path,
      targetPath: dir,
      success: () => resolve(),
      fail: reject,
    }),
  )
    .then(async () => {
      const [strings, sheet] = await Promise.all([
        read('xl/sharedStrings.xml'),
        read('xl/worksheets/sheet1.xml'),
      ]);
      return wechatRows(sheetRows(sheet, sharedStrings(strings)));
    })
    .finally(() =>
      fs.rmdir({ dirPath: dir, recursive: true, fail: () => undefined }),
    );
}

/** 读账单文件 → 云端整理、查重。只把每笔要用的几列发给云端。 */
export async function parseBillFile(
  path: string,
): Promise<{ items: BillItem[]; skipped: FileSkipped }> {
  let rows: ReturnType<typeof wechatRows>;
  try {
    rows = await readWechatFile(path);
  } catch {
    throw new ApiError(NOT_WECHAT, 'VALIDATION');
  }
  if (!rows) throw new ApiError(NOT_WECHAT, 'VALIDATION');
  if (!rows.length) throw new ApiError('这份账单里没有交易。', 'VALIDATION');
  return callApi('bill.file', { app: 'wechat', rows });
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
