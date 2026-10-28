/**
 * 账单文件：在手机上把微信账单 Excel 读成每笔几列文字，交给云函数 bill.file 整理。
 * xlsx 是 zip 包，解压由 services/bills.ts 用 FileSystemManager.unzip 做；这里只处理里面的两个 XML：
 * xl/sharedStrings.xml（所有文字）和 xl/worksheets/sheet1.xml（表格）。
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

export interface FileChunk {
  /** 本批要整理的行。 */
  rows: FileRow[];
  /** 前后日期里的退款和被退款的行，只给本批配对退款用。 */
  context: FileRow[];
}

/** 交易时间是 Excel 的天数；读不出来返回 NaN（配对时一律带上）。 */
function dayOf(row: FileRow): number {
  return Number(row.time);
}

/**
 * 把整份账单切成每批 CHUNK_ROWS 行。退款行和它的原支出可能被切到两批里，
 * 所以每批再带上前后 PAIR_DAYS 天里「退款」相关的行（几十行）当配对用的上下文。
 */
export function fileChunks(rows: FileRow[]): FileChunk[] {
  const related = rows.filter((row) => /退款|退还/.test(row.status + row.type));
  const chunks: FileChunk[] = [];
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
