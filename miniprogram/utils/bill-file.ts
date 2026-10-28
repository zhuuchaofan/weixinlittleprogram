/**
 * 账单文件：在手机上把微信账单 Excel 读成每笔几列文字，交给云函数 bill.file 整理。
 * xlsx 是 zip 包，解压由 services/bills.ts 用 FileSystemManager.unzip 做；这里只处理里面的两个 XML：
 * xl/sharedStrings.xml（所有文字）和 xl/worksheets/sheet1.xml（表格）。
 * 支付宝账单是 GBK 编码的 CSV，手机上没有 GBK 解码，按字节切开，文字列原样（每个字节一个字符）交给云端解码。
 * 不依赖任何库、不 import 别的文件，方便在 node 里直接测。
 */

/** 送去云端的一行：只有记账要用的几列。昵称、支付方式（银行卡）、商品、商户单号、备注不出手机。 */
export interface FileRow {
  time: string;
  type: string;
  peer: string;
  io: string;
  amount: string;
  status: string;
  tx: string;
}

// 微信账单的表头，和 FileRow 的字段对应。
const WECHAT_COLUMNS: Record<keyof FileRow, string> = {
  time: '交易时间',
  type: '交易类型',
  peer: '交易对方',
  io: '收/支',
  amount: '金额(元)',
  status: '当前状态',
  tx: '交易单号',
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** 所有匹配（不用 matchAll：旧版 iOS 的小程序运行环境没有）。pattern 要带 g。 */
function matches(pattern: RegExp, text: string): RegExpExecArray[] {
  const result: RegExpExecArray[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text))
    result.push(match);
  return result;
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name[0] === '#')
      return String.fromCodePoint(
        name[1].toLowerCase() === 'x'
          ? parseInt(name.slice(2), 16)
          : Number(name.slice(1)),
      );
    return ENTITIES[name] ?? whole;
  });
}

/** 一段 XML 里所有 <t> 的文字连起来（带格式的文字会拆成几段 <r><t>）。 */
function textOf(xml: string): string {
  let result = '';
  for (const match of matches(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, xml))
    result += decode(match[1]);
  return result;
}

export function sharedStrings(xml: string): string[] {
  return matches(/<si>([\s\S]*?)<\/si>/g, xml).map((match) => textOf(match[1]));
}

/** "A" → 0，"K" → 10，"AA" → 26。 */
function columnIndex(ref: string): number {
  let index = 0;
  for (const letter of ref.replace(/\d+$/, ''))
    index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

/** 表格 → 每行一个字符串数组。数字原样（日期是 Excel 的天数），文字取共享字符串。 */
export function sheetRows(sheetXml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of matches(/<row\b[^>]*>([\s\S]*?)<\/row>/g, sheetXml)) {
    const cells: string[] = [];
    const pattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    for (const cell of matches(pattern, row[1])) {
      const attrs = cell[1];
      const body = cell[2] || '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = strings[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = textOf(body);
      else if (raw !== undefined) value = decode(raw);
      cells[ref ? columnIndex(ref) : cells.length] = value.trim();
    }
    rows.push(Array.from(cells, (value) => value ?? ''));
  }
  return rows;
}

/**
 * 认出微信账单并取出要用的几列。表头前有十几行说明（昵称、合计），全部丢掉。
 * 不是微信账单返回 null。
 */
export function wechatRows(rows: string[][]): FileRow[] | null {
  const head = rows.findIndex((row) =>
    Object.values(WECHAT_COLUMNS).every((name) => row.includes(name)),
  );
  if (head < 0) return null;
  const header = rows[head];
  const fields = Object.entries(WECHAT_COLUMNS) as Array<
    [keyof FileRow, string]
  >;
  return rows
    .slice(head + 1)
    .filter((row) => row.some(Boolean))
    .map((row) => {
      const result = {} as FileRow;
      for (const [field, name] of fields)
        result[field] = row[header.indexOf(name)] ?? '';
      return result;
    });
}

// 一次请求带多少行：一年的账单有一千多行，一次发过去会超出云函数的请求大小，所以分批。
export const CHUNK_ROWS = 150;
// 退款和原支出相隔多少天以内算同一批（超出的退款会被当成单独一笔收入）。
const PAIR_DAYS = 45;

export interface FileChunk<T = FileRow> {
  /** 本批要整理的行。 */
  rows: T[];
  /** 前后日期里的退款和被退款的行，只给本批配对退款用。 */
  context: T[];
}

/**
 * 把整份账单切成每批 CHUNK_ROWS 行。退款行和它的原支出可能被切到两批里，
 * 所以每批再带上前后 PAIR_DAYS 天里 related（退款和被退款的行，几十行）当配对用的上下文。
 * dayOf 把一行的时间换成天数，读不出来返回 NaN（配对时一律带上）。
 */
function chunkRows<T>(
  rows: T[],
  related: T[],
  dayOf: (row: T) => number,
): Array<FileChunk<T>> {
  const chunks: Array<FileChunk<T>> = [];
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    const own = rows.slice(i, i + CHUNK_ROWS);
    const days = own.map(dayOf).filter((day) => !Number.isNaN(day));
    const from = Math.min(...days) - PAIR_DAYS;
    const to = Math.max(...days) + PAIR_DAYS;
    const inside = new Set(own);
    chunks.push({
      rows: own,
      context: related.filter((row) => {
        if (inside.has(row)) return false;
        const day = dayOf(row);
        return (
          Number.isNaN(day) || days.length === 0 || (day >= from && day <= to)
        );
      }),
    });
  }
  return chunks;
}

/** 微信：交易时间是 Excel 的天数。 */
export function fileChunks(rows: FileRow[]): Array<FileChunk> {
  return chunkRows(
    rows,
    rows.filter((row) => /退款|退还/.test(row.status + row.type)),
    (row) => Number(row.time),
  );
}

/** 支付宝送去云端的一行：文字列是原始字节（每个字节一个字符），时间、金额、单号是 ASCII。 */
export interface AlipayRow {
  time: string;
  cls: string;
  peer: string;
  goods: string;
  io: string;
  amount: string;
  status: string;
  tx: string;
}

// 表头的字节：GBK 和 UTF-8 各一份（支付宝现在是 GBK，万一改了也认得）。
const ALIPAY_HEADS: Record<'gbk' | 'utf-8', string[]> = {
  gbk: ['bdbbd2d7cab1bce4', 'bdbbd2d7b7d6c0e0'],
  'utf-8': ['e4baa4e69893e697b6e997b4', 'e4baa4e69893e58886e7b1bb'],
};
// 要用的列在表头里的位置：交易时间、交易分类、交易对方、商品说明、收/支、金额、交易状态、交易订单号。
const ALIPAY_COLUMNS: Record<keyof AlipayRow, number> = {
  time: 0,
  cls: 1,
  peer: 2,
  goods: 4,
  io: 5,
  amount: 6,
  status: 8,
  tx: 9,
};

function hex(bytes: Uint8Array, from: number, to: number): string {
  let result = '';
  for (let i = from; i < Math.min(to, bytes.length); i++)
    result += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return result;
}

function latin1(bytes: Uint8Array, from: number, to: number): string {
  let result = '';
  for (let i = from; i < to; i++) result += String.fromCharCode(bytes[i]);
  return result;
}

/** 一行字节按逗号切成几格（逗号和引号都是 ASCII，GBK 的后一个字节不会是它们）。 */
function csvCells(bytes: Uint8Array, from: number, to: number): string[] {
  const cells: string[] = [];
  let start = from;
  let quoted = false;
  let text = '';
  for (let i = from; i <= to; i++) {
    const byte = i < to ? bytes[i] : 0x2c;
    if (byte === 0x22) {
      if (quoted && bytes[i + 1] === 0x22) {
        text += latin1(bytes, start, i + 1);
        i++;
        start = i + 1;
      } else {
        text += latin1(bytes, start, i);
        quoted = !quoted;
        start = i + 1;
      }
    } else if (byte === 0x2c && !quoted) {
      cells.push((text + latin1(bytes, start, i)).trim());
      text = '';
      start = i + 1;
    }
  }
  return cells;
}

/**
 * 认出支付宝账单 CSV 并取出要用的几列。表头前有二十多行说明（姓名、账号、合计），全部丢掉。
 * 不是支付宝账单返回 null。
 */
export function alipayRows(
  bytes: Uint8Array,
): { enc: 'gbk' | 'utf-8'; rows: AlipayRow[] } | null {
  let enc: 'gbk' | 'utf-8' | null = null;
  const rows: AlipayRow[] = [];
  let start = 0;
  for (let i = 0; i <= bytes.length; i++) {
    if (i < bytes.length && bytes[i] !== 0x0a) continue;
    const end = i > start && bytes[i - 1] === 0x0d ? i - 1 : i;
    if (end > start) {
      if (!enc) {
        // 表头行以「交易时间,交易分类,」开头（可能带 BOM）
        const from =
          hex(bytes, start, start + 3) === 'efbbbf' ? start + 3 : start;
        for (const name of ['gbk', 'utf-8'] as const) {
          const [time, cls] = ALIPAY_HEADS[name];
          const head = hex(
            bytes,
            from,
            from + time.length / 2 + 1 + cls.length / 2,
          );
          if (head === `${time}2c${cls}`) enc = name;
        }
      } else {
        const cells = csvCells(bytes, start, end);
        if (cells.length >= 10) {
          const row = {} as AlipayRow;
          for (const field of Object.keys(ALIPAY_COLUMNS) as Array<
            keyof AlipayRow
          >)
            row[field] = cells[ALIPAY_COLUMNS[field]] ?? '';
          // 时间列不是日期的行（文件末尾的说明）丢掉
          if (/^\d{4}-\d{2}-\d{2}/.test(row.time)) rows.push(row);
        }
      }
    }
    start = i + 1;
  }
  return enc ? { enc, rows } : null;
}

/** 支付宝的时间是文本「2026-10-22 11:11:54」。 */
function alipayDay(row: AlipayRow): number {
  return Date.parse(`${row.time.slice(0, 10)}T00:00:00Z`) / 86400000;
}

// 「退款」两个字的原始字节（每个字节一个字符），文字列没有解码，只能这样比。
const REFUND_WORD = {
  gbk: '\xcd\xcb\xbf\xee',
  'utf-8': '\xe9\x80\x80\xe6\xac\xbe',
};

/** 退款行和它们的原支出（同一个商户、商品前 15 个字节相同）当配对上下文。 */
export function alipayChunks(
  rows: AlipayRow[],
  enc: 'gbk' | 'utf-8',
): Array<FileChunk<AlipayRow>> {
  const word = REFUND_WORD[enc];
  const goodsOf = (row: AlipayRow) =>
    row.goods.startsWith(`${word}-`)
      ? row.goods.slice(word.length + 1)
      : row.goods;
  const keyOf = (row: AlipayRow) => `${row.peer}|${goodsOf(row).slice(0, 15)}`;
  const wanted = new Set(rows.filter((row) => row.cls === word).map(keyOf));
  const related = rows.filter(
    (row) => row.cls === word || wanted.has(keyOf(row)),
  );
  return chunkRows(rows, related, alipayDay);
}
