import type { BillItem, FileSkipped } from '../models';
import { BILL_IMPORT } from '../config/options';
import {
  alipayChunks,
  alipayRows,
  fileChunks,
  sharedStrings,
  sheetRows,
  wechatRows,
} from '../utils/bill-file';
import { ApiError, callApi, initializeCloud } from './cloud';

// 主页或记账页选好的截图或账单文件，导入页取走后清空。
let pending: string[] = [];
let pendingFile = '';
let pendingApp: FileApp = 'wechat';

export type FileApp = 'wechat' | 'alipay';

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

export function takePendingFile(): { path: string; app: FileApp } {
  const path = pendingFile;
  pendingFile = '';
  return { path, app: pendingApp };
}

/** 记账页、主页的「导入账单」：选截图还是微信账单文件。 */
export async function chooseBillImport(): Promise<void> {
  let tapIndex: number;
  try {
    ({ tapIndex } = await wx.showActionSheet({
      itemList: [
        '账单截图（AI 识别）',
        '微信账单文件（Excel）',
        '支付宝账单文件（CSV）',
      ],
    }));
  } catch {
    return; // 取消
  }
  // 等选项框收起再弹下一个框，否则有的手机上后面的说明框弹不出来。
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (tapIndex === 0) await pickBillScreenshots();
  else await pickBillFile(tapIndex === 1 ? 'wechat' : 'alipay');
}

// 第一次选账单文件时说明怎么拿到文件；看过就记在这台手机上（微信、支付宝各说明一次）。
const FILE_GUIDES: Record<FileApp, { key: string; content: string }> = {
  wechat: {
    key: 'billFileGuided',
    content:
      '微信：我 → 服务 → 钱包 → 账单 → 右上角「…」→ 下载账单 → 用于个人对账，选好时间，微信支付会发来一张「账单流水文件」通知。点「查看详情」打开文件，用右上角「…」发送给「文件传输助手」，再回到这里，从文件传输助手里选这个文件。文件只在手机上读取，不会上传。',
  },
  alipay: {
    key: 'billFileGuidedAlipay',
    content:
      '支付宝：我的 → 账单 → 右上角「…」→ 开具交易流水证明 → 用于个人对账 → 申请，选好时间和接收方式，拿到 CSV 文件后发送到微信的「文件传输助手」，再回到这里，从文件传输助手里选这个文件。文件只在手机上读取，不会上传。',
  },
};

async function readGuide(app: FileApp): Promise<boolean> {
  const guide = FILE_GUIDES[app];
  try {
    if (wx.getStorageSync(guide.key)) return true;
  } catch {
    /* 读不到就再说明一次 */
  }
  const result = await wx.showModal({
    title: '怎么拿到账单文件',
    content: guide.content,
    confirmText: '去选文件',
    cancelText: '先不用',
  });
  if (!result.confirm) return false;
  try {
    wx.setStorageSync(guide.key, 1);
  } catch {
    /* 存不下次再说明 */
  }
  return true;
}

/** 账单文件：从微信聊天里选微信账单 Excel / 支付宝账单 CSV，到导入页读取和确认。 */
export async function pickBillFile(app: FileApp): Promise<void> {
  if (!(await readGuide(app))) return;
  let path: string;
  try {
    const result = await wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: [app === 'alipay' ? 'csv' : 'xlsx'],
    });
    path = result.tempFiles[0]?.path || '';
  } catch (error) {
    // 取消选择不用提示；其他失败（多半是隐私指引里没声明「选中的文件」）要说出来，不能没反应。
    const detail = (error as { errMsg?: string })?.errMsg || '';
    if (/cancel/i.test(detail)) return;
    wx.showModal({
      title: '没能打开聊天里的文件',
      content: /privacy|scope|112/i.test(detail)
        ? `小程序的隐私保护指引里还没声明「选中的文件」。已经补过的话，请把小程序从后台划掉再重新打开一次。\n${detail}`
        : `请稍后再试。\n${detail}`,
      showCancel: false,
    });
    return;
  }
  if (!path) return;
  pendingFile = path;
  pendingApp = app;
  wx.navigateTo({ url: '/pages/bill-import/index?mode=file' });
}

const NOT_FILE: Record<FileApp, string> = {
  wechat: '没能读懂这个文件，请选微信「下载账单 → 用于个人对账」发来的 Excel。',
  alipay:
    '没能读懂这个文件，请选支付宝「开具交易流水证明 → 用于个人对账」发来的 CSV。',
};

/** 支付宝账单 CSV：读成字节，在手机上按逗号切开，不解码。 */
function readAlipayFile(path: string): Promise<ReturnType<typeof alipayRows>> {
  return new Promise((resolve, reject) =>
    wx.getFileSystemManager().readFile({
      filePath: path,
      success: (result) =>
        resolve(alipayRows(new Uint8Array(result.data as ArrayBuffer))),
      fail: reject,
    }),
  );
}

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

/**
 * 读账单文件 → 云端整理、查重。只把每笔要用的几列发给云端；整份文件分批发（一次发太多会超出
 * 云函数的请求大小），onProgress 报告已经处理了多少行。
 */
export async function parseBillFile(
  path: string,
  app: FileApp,
  onProgress?: (done: number, total: number) => void,
): Promise<{ items: BillItem[]; skipped: FileSkipped }> {
  let rows: unknown[] | null = null;
  let chunks: Array<{ rows: unknown[]; context: unknown[] }> = [];
  let enc: string | undefined;
  try {
    if (app === 'alipay') {
      const file = await readAlipayFile(path);
      if (file) {
        enc = file.enc;
        rows = file.rows;
        chunks = alipayChunks(file.rows, file.enc);
      }
    } else {
      const file = await readWechatFile(path);
      if (file) {
        rows = file;
        chunks = fileChunks(file);
      }
    }
  } catch {
    throw new ApiError(NOT_FILE[app], 'VALIDATION');
  }
  if (!rows) throw new ApiError(NOT_FILE[app], 'VALIDATION');
  if (!rows.length) throw new ApiError('这份账单里没有交易。', 'VALIDATION');
  if (rows.length > BILL_IMPORT.maxFileRows)
    throw new ApiError(
      `一次最多导入 ${BILL_IMPORT.maxFileRows} 笔，请把账单的时间范围选短一些。`,
      'VALIDATION',
    );
  const items: BillItem[] = [];
  const skipped: FileSkipped = {
    neutral: 0,
    closed: 0,
    refunded: 0,
    broken: 0,
  };
  let done = 0;
  for (const chunk of chunks) {
    onProgress?.(done, rows.length);
    const result = await callApi<{ items: BillItem[]; skipped: FileSkipped }>(
      'bill.file',
      { app, enc, rows: chunk.rows, context: chunk.context },
    );
    items.push(...result.items);
    for (const key of Object.keys(skipped) as Array<keyof FileSkipped>)
      skipped[key] += result.skipped[key];
    done += chunk.rows.length;
  }
  return { items, skipped };
}

/** 压缩失败就用原图。 */
export async function compressed(path: string): Promise<string> {
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
      throw new ApiError('截图没传上去，网络好一点再试试。', 'NETWORK');
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
