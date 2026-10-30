/**
 * 从 JPEG 开头的一段字节里读拍摄日期（EXIF 的 DateTimeOriginal，没有就用 DateTime）。
 * 不 import 别的文件，方便在 node 里直接测。读不到、格式不对都返回空字符串。
 */

const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_TIME = 0x0132;
const TAG_DATE_ORIGINAL = 0x9003;
const TAG_DATE_DIGITIZED = 0x9004;

/** 读 IFD 里一个 ASCII 字段，返回 { tag → 文字 } 和 EXIF 子目录的位置。 */
function readIfd(
  view: DataView,
  tiff: number,
  offset: number,
  little: boolean,
): { texts: Record<number, string>; exifIfd: number } {
  const texts: Record<number, string> = {};
  let exifIfd = 0;
  const start = tiff + offset;
  if (start < 0 || start + 2 > view.byteLength) return { texts, exifIfd };
  const count = view.getUint16(start, little);
  for (let i = 0; i < count; i++) {
    const entry = start + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const length = view.getUint32(entry + 4, little);
    if (tag === TAG_EXIF_IFD) exifIfd = view.getUint32(entry + 8, little);
    if (
      type === 2 &&
      length >= 19 &&
      length <= 32 &&
      (tag === TAG_DATE_TIME ||
        tag === TAG_DATE_ORIGINAL ||
        tag === TAG_DATE_DIGITIZED)
    ) {
      const at = tiff + view.getUint32(entry + 8, little);
      if (at + 19 > view.byteLength) continue;
      let text = '';
      for (let j = 0; j < 19; j++)
        text += String.fromCharCode(view.getUint8(at + j));
      texts[tag] = text;
    }
  }
  return { texts, exifIfd };
}

/** 拍摄日期 YYYY-MM-DD；读不到返回空字符串。 */
export function exifDate(buffer: ArrayBuffer): string {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 12 || view.getUint16(0) !== 0xffd8) return '';
    let pos = 2;
    while (pos + 4 <= view.byteLength) {
      if (view.getUint8(pos) !== 0xff) return '';
      const marker = view.getUint8(pos + 1);
      const size = view.getUint16(pos + 2);
      if (marker === 0xda) return '';
      if (marker === 0xe1 && view.getUint32(pos + 4) === 0x45786966) {
        const tiff = pos + 10;
        const little = view.getUint16(tiff) === 0x4949;
        const first = readIfd(
          view,
          tiff,
          view.getUint32(tiff + 4, little),
          little,
        );
        const sub = first.exifIfd
          ? readIfd(view, tiff, first.exifIfd, little).texts
          : {};
        const text =
          sub[TAG_DATE_ORIGINAL] ||
          sub[TAG_DATE_DIGITIZED] ||
          first.texts[TAG_DATE_TIME] ||
          '';
        const match = /^(\d{4}):(\d{2}):(\d{2}) /.exec(text);
        if (!match) return '';
        const month = Number(match[2]);
        const day = Number(match[3]);
        return month >= 1 && month <= 12 && day >= 1 && day <= 31
          ? `${match[1]}-${match[2]}-${match[3]}`
          : '';
      }
      pos += 2 + size;
    }
  } catch {
    // 读不懂就当没有，日期让人自己选。
  }
  return '';
}
