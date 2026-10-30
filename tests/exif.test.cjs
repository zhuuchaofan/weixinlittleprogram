const test = require('node:test');
const assert = require('node:assert/strict');
const { exifDate } = require('../miniprogram/utils/exif.ts');

/** 拼一个最小的带 EXIF 的 JPEG 开头：IFD0 里有指向 EXIF 子目录的指针，子目录里是拍摄时间。 */
function jpeg({ little = false, original = '', plain = '' } = {}) {
  const u16 = (n) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n) =>
    little
      ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]
      : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const ascii = (text) => [...Buffer.from(text + '\0', 'latin1')];
  const entries = [];
  const tail = [];
  // IFD0 在 TIFF 头后 8 字节；两个目录的数据都排在目录后面。
  const ifd0Count = (plain ? 1 : 0) + (original ? 1 : 0);
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const subOffset = 8 + ifd0Size;
  const subSize = original ? 2 + 12 + 4 : 0;
  let dataAt = subOffset + subSize;
  const ifd0 = [...u16(ifd0Count)];
  if (plain) {
    ifd0.push(...u16(0x0132), ...u16(2), ...u32(20), ...u32(dataAt));
    tail.push(...ascii(plain));
    dataAt += 20;
  }
  if (original)
    ifd0.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(subOffset));
  ifd0.push(...u32(0));
  const sub = [];
  if (original) {
    sub.push(
      ...u16(1),
      ...u16(0x9003),
      ...u16(2),
      ...u32(20),
      ...u32(dataAt),
      ...u32(0),
    );
    tail.push(...ascii(original));
  }
  entries.push(
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...ifd0,
    ...sub,
    ...tail,
  );
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...entries];
  const size = body.length + 2;
  const bytes = [
    0xff,
    0xd8,
    0xff,
    0xe1,
    size >> 8,
    size & 255,
    ...body,
    0xff,
    0xd9,
  ];
  return new Uint8Array(bytes).buffer;
}

test('读拍摄日期：优先 DateTimeOriginal，两种字节序都行', () => {
  assert.equal(
    exifDate(jpeg({ original: '2024:05:20 10:03:09' })),
    '2024-05-20',
  );
  assert.equal(
    exifDate(jpeg({ little: true, original: '2023:01:02 00:00:00' })),
    '2023-01-02',
  );
  assert.equal(
    exifDate(
      jpeg({ original: '2024:05:20 10:03:09', plain: '2025:01:01 00:00:00' }),
    ),
    '2024-05-20',
  );
});

test('读拍摄日期：没有拍摄时间就用修改时间，不是 JPEG 或读不懂返回空', () => {
  assert.equal(exifDate(jpeg({ plain: '2022:12:31 23:59:59' })), '2022-12-31');
  assert.equal(
    exifDate(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer),
    '',
  );
  assert.equal(exifDate(new ArrayBuffer(0)), '');
  assert.equal(exifDate(jpeg({ original: '0000:00:00 00:00:00' })), '');
  assert.equal(exifDate(jpeg({ original: 'not a date at all!!' })), '');
});
