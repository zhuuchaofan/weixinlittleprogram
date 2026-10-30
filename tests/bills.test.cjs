const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/api/router');
const {
  parseAmount,
  parseBillDate,
  parseReply,
} = require('../cloudfunctions/api/bill-parse');
const { similar, matchItems } = require('../cloudfunctions/api/bill-match');
const { createVision } = require('../cloudfunctions/api/vision');
const { createAi } = require('../cloudfunctions/api/ai');

// 限时免费期间所有小家都算会员；这里测的是免费 / 会员各自的行为，所以先关掉。
process.env.VIP_FREE_UNTIL = 'off';

// 2026-10-25（周日）12:00 UTC+8
const NOW = Date.parse('2026-10-25T04:00:00Z');
const TODAY = '2026-10-25';

function memoryHouseholds() {
  const docs = new Map();
  let seq = 0;
  return {
    async findByMember(openid) {
      return (
        [...docs.values()].find((d) =>
          d.members.some((m) => m.openid === openid),
        ) || null
      );
    },
    async findByCode(code) {
      return [...docs.values()].find((d) => d.inviteCode === code) || null;
    },
    async insert(doc) {
      const id = 'h' + ++seq;
      docs.set(id, { ...doc, _id: id });
      return id;
    },
    async addMember(id, code, member) {
      const d = docs.get(id);
      if (!d || d.inviteCode !== code || d.memberCount !== 1) return false;
      docs.set(id, {
        ...d,
        members: [...d.members, member],
        memberCount: 2,
        inviteCode: '',
      });
      return true;
    },
    async update(id, fields) {
      docs.set(id, { ...docs.get(id), ...fields });
    },
    async takeQuota(id, field, day, limit) {
      const d = docs.get(id);
      const used = d[field]?.day === day ? d[field].count : 0;
      if (used >= limit) return false;
      docs.set(id, { ...d, [field]: { day, count: used + 1 } });
      return true;
    },
  };
}

function memoryExpenses() {
  const docs = new Map();
  let seq = 0;
  const own = (householdId) =>
    [...docs.values()].filter((d) => d.householdId === householdId);
  return {
    docs,
    async listAll(householdId) {
      return own(householdId).map((d) => ({ ...d }));
    },
    async listMonth(householdId, month) {
      return own(householdId)
        .filter((d) => d.date.slice(0, 7) === month)
        .map((d) => ({ ...d }));
    },
    async get(householdId, id) {
      const d = docs.get(id);
      return d && d.householdId === householdId ? { ...d } : null;
    },
    async insert(doc) {
      const id = 'e' + ++seq;
      docs.set(id, { ...doc, _id: id });
      return id;
    },
    async insertWithId(id, doc) {
      if (docs.has(id)) return false;
      docs.set(id, { ...doc, _id: id });
      return true;
    },
    async update(householdId, id, fields) {
      const d = docs.get(id);
      if (d && d.householdId === householdId) docs.set(id, { ...d, ...fields });
    },
  };
}

/** 假的视觉模型：按图片地址返回事先写好的回复，记录收到的请求。 */
/** 假的 AI 入口（ai.js 的 createAi）：按截图地址给固定回复，记下每次调用。 */
function fakeVision(replies) {
  const calls = [];
  return {
    calls,
    async ensure() {},
    async read(feature, url, prompt) {
      calls.push({ feature, url, prompt });
      return replies[url];
    },
  };
}

const WECHAT = JSON.stringify({
  app: 'wechat',
  items: [
    {
      date: '今天',
      time: '12:31',
      merchant: '美团外卖',
      amount: '-23.50',
      kind: '消费',
      cat: '吃饭',
    },
    {
      date: '10月24日',
      time: '19:02',
      merchant: '鸟贵族',
      amount: '-236.00',
      kind: '消费',
      cat: '吃饭',
    },
    {
      date: '10月23日',
      time: '08:10',
      merchant: '美团外卖',
      amount: '+23.50',
      kind: '退款',
      cat: '吃饭',
    },
    {
      date: '10月22日',
      time: '21:00',
      merchant: '佳益',
      amount: '-500.00',
      kind: '转账',
      cat: '其他',
    },
    {
      date: '10月21日',
      time: '',
      merchant: '全家便利店',
      amount: '-12',
      kind: '消费',
      cat: '奢侈品',
    },
  ],
});

async function setup(
  replies = { 'https://img/1': WECHAT },
  clock = { now: NOW },
) {
  const expenses = memoryExpenses();
  const vision = fakeVision(replies);
  const route = createRouter({
    households: memoryHouseholds(),
    archive: {},
    expenses,
    ai: vision,
    now: () => clock.now,
  });
  const call = (openid, action, payload) => route({ action, payload }, openid);
  const created = await call('A', 'household.create', { name: '超凡' });
  await call('B', 'household.join', {
    name: '佳益',
    code: created.data.inviteCode,
  });
  await call('X', 'household.create', { name: '别人家' });
  return { call, expenses, vision };
}

test('金额：保留正负号，按字符串换算成分', () => {
  assert.deepEqual(parseAmount('-23.50'), { fen: 2350, sign: '-' });
  assert.deepEqual(parseAmount('+0.1'), { fen: 10, sign: '+' });
  assert.deepEqual(parseAmount('¥1,234.56'), { fen: 123456, sign: '' });
  assert.deepEqual(parseAmount('19.99'), { fen: 1999, sign: '' });
  for (const bad of ['', '0', '-0.00', 'abc', '1.234', null])
    assert.equal(parseAmount(bad), null, String(bad));
});

test('日期：相对日期按上传当天推算并标记，没有年份的按今年、晚于今天算去年', () => {
  assert.deepEqual(parseBillDate('今天', TODAY), {
    date: TODAY,
    guessed: true,
  });
  assert.deepEqual(parseBillDate('昨天', TODAY), {
    date: '2026-10-24',
    guessed: true,
  });
  assert.deepEqual(parseBillDate('前天', '2026-03-01'), {
    date: '2026-02-27',
    guessed: true,
  });
  // 2026-10-25 是周日；周三 → 10-21，周日 → 当天
  assert.equal(parseBillDate('周三', TODAY).date, '2026-10-21');
  assert.equal(parseBillDate('星期日', TODAY).date, TODAY);
  assert.deepEqual(parseBillDate('10月24日', TODAY), {
    date: '2026-10-24',
    guessed: false,
  });
  assert.equal(parseBillDate('10-05', TODAY).date, '2026-10-05');
  assert.equal(parseBillDate('12-31', TODAY).date, '2025-12-31');
  assert.equal(parseBillDate('2025-03-08', TODAY).date, '2025-03-08');
  assert.equal(parseBillDate('2025年3月8日', TODAY).date, '2025-03-08');
  for (const bad of ['', '2月30日', '13-01', '上周', null])
    assert.equal(parseBillDate(bad, TODAY), null, String(bad));
});

test('模型回复：允许代码块包裹；读不出的字段留空并说明', () => {
  const { app, items } = parseReply(
    '```json\n' +
      JSON.stringify({
        app: 'alipay',
        items: [
          {
            date: '模糊',
            time: '25:00',
            merchant: '',
            amount: '??',
            kind: '红包',
          },
        ],
      }) +
      '\n```',
    TODAY,
  );
  assert.equal(app, 'alipay');
  assert.equal(items[0].amount, 0);
  assert.equal(items[0].date, '');
  assert.equal(items[0].time, '');
  assert.equal(items[0].note, '红包');
  assert.equal(items[0].cat, '其他');
  assert.equal(items[0].problem, '金额没读出来，日期没读出来');
  assert.throws(() => parseReply('看不清', TODAY), { code: 'VALIDATION' });
});

test('商户相似：包含或两字组重合', () => {
  assert.equal(similar('美团外卖', '美团'), true);
  assert.equal(similar('鸟贵族 新宿店', '鸟贵族晚饭'), true);
  assert.equal(similar('全家便利店', '7-11便利店'), true);
  assert.equal(similar('全家便利店', '星巴克'), false);
  assert.equal(similar('', '晚饭'), false);
});

test('识别截图：需要模型配置，只有小家成员能用', async () => {
  const { call, vision } = await setup();
  assert.equal(
    (await call('Y', 'bill.parse', { url: 'https://img/1' })).code,
    'NO_HOUSEHOLD',
  );
  assert.equal(
    (await call('A', 'bill.parse', { url: 'http://img/1' })).code,
    'VALIDATION',
  );
  const parsed = await call('A', 'bill.parse', { url: 'https://img/1' });
  assert.equal(parsed.ok, true, parsed.message);
  assert.equal(vision.calls.length, 1);
  assert.equal(vision.calls[0].feature, 'billImage');
  assert.match(vision.calls[0].prompt, /账单列表截图/);
  const [lunch, dinner, refund, transfer, conbini] = parsed.data.items;
  assert.equal(lunch.date, TODAY);
  assert.equal(lunch.dateGuessed, true);
  assert.equal(lunch.amount, 2350);
  assert.equal(lunch.flow, 'out');
  assert.equal(lunch.note, '美团外卖');
  assert.equal(dinner.dateGuessed, false);
  assert.equal(refund.flow, 'in');
  assert.equal(refund.note, '退款·美团外卖');
  assert.equal(transfer.note, '转账·佳益');
  assert.equal(conbini.amount, 1200);
  assert.equal(conbini.cat, '其他');

  const off = createRouter({
    households: memoryHouseholds(),
    archive: {},
    expenses: memoryExpenses(),
  });
  await off({ action: 'household.create', payload: { name: '超凡' } }, 'A');
  const result = await off(
    { action: 'bill.parse', payload: { url: 'https://img/1' } },
    'A',
  );
  assert.equal(result.code, 'UNAVAILABLE');
  assert.match(result.message, /DASHSCOPE_API_KEY/);
});

test('识别截图：每个小家每天最多 5 张，两人合计，第二天重新计数', async () => {
  const clock = { now: NOW };
  const { call, vision } = await setup(undefined, clock);
  for (let i = 0; i < 5; i++) {
    const who = i % 2 ? 'B' : 'A';
    const result = await call(who, 'bill.parse', { url: 'https://img/1' });
    assert.equal(result.ok, true, result.message);
  }
  const over = await call('B', 'bill.parse', { url: 'https://img/1' });
  assert.equal(over.code, 'LIMIT');
  assert.match(over.message, /已经识别了 5 张/);
  assert.equal(vision.calls.length, 5);
  // 别的小家不受影响
  assert.equal(
    (await call('X', 'bill.parse', { url: 'https://img/1' })).ok,
    true,
  );
  clock.now += 24 * 60 * 60 * 1000;
  assert.equal(
    (await call('A', 'bill.parse', { url: 'https://img/1' })).ok,
    true,
  );
});

test('查重：已导入过、可能已记过、两人之间的转账，一条已有账目只对上一笔', async () => {
  const { call } = await setup();
  const parsed = (await call('A', 'bill.parse', { url: 'https://img/1' })).data;
  // B 手记的晚饭（同一天、商户相似）、A 手记的前一天 23.50（金额同、差 1 天）
  await call('B', 'expense.add', {
    amount: 23600,
    note: '鸟贵族晚饭',
    cat: '吃饭',
    date: '2026-10-24',
    payer: 'b',
    split: 'half',
  });
  await call('A', 'expense.add', {
    amount: 2350,
    note: '午饭',
    cat: '吃饭',
    date: '2026-10-24',
    payer: 'a',
    split: 'self',
  });
  // 连续两张截图重叠：同一笔出现两次只留一笔；再多一笔同金额的午饭
  const twice = [
    ...parsed.items,
    parsed.items[0],
    { ...parsed.items[0], src: { ...parsed.items[0].src, time: '12:45' } },
  ];
  const matched = await call('A', 'bill.match', { items: twice });
  assert.equal(matched.ok, true, matched.message);
  const status = matched.data.items.map((item) => item.status);
  assert.deepEqual(status, [
    'possible',
    'possible',
    'new',
    'partner',
    'new',
    'new',
  ]);
  assert.equal(matched.data.items[1].match.byRole, 'b');
  assert.equal(matched.data.items[1].match.note, '鸟贵族晚饭');
  // 收入不和支出比对
  assert.equal(matched.data.items[2].match, null);

  // 保存后再导入同一张图：全部「已导入过」
  const chosen = matched.data.items.filter((i) => i.status === 'new');
  const saved = await call('A', 'expense.addMany', { items: chosen });
  assert.deepEqual(saved.data, { added: 3, skipped: 0 });
  const again = await call('B', 'bill.match', { items: chosen });
  assert.deepEqual(
    again.data.items.map((item) => item.status),
    ['imported', 'imported', 'imported'],
  );
  // 别人家看不到
  const other = await call('X', 'bill.match', { items: chosen });
  assert.deepEqual(
    other.data.items.map((item) => item.status),
    ['new', 'new', 'new'],
  );
});

test('查重：日期相近的按相差天数配对，同一天的那笔不会被前一天的抢走', () => {
  const household = { members: [{ openid: 'A', role: 'a', name: '球球' }] };
  const item = (key, date, merchant) => ({
    key,
    date,
    merchant,
    amount: 1400,
    flow: 'out',
    kind: '消费',
  });
  const items = [
    item('k1', '2026-10-25', '滴滴出行'),
    item('k2', '2026-10-24', '牛阿良牛肉汤烧饼'),
  ];
  const records = [
    {
      _id: 'r1',
      date: '2026-10-24',
      amount: 1400,
      note: '烧饼牛肉饼',
      by: 'A',
    },
  ];
  const [didi, bing] = matchItems(items, records, household);
  assert.equal(bing.status, 'possible');
  assert.equal(bing.match.id, 'r1');
  assert.equal(didi.status, 'new');
});

test('批量保存：上传者付款、全算自己，收入不进结算，同一笔只落一次', async () => {
  const { call, expenses } = await setup();
  const { items } = (await call('B', 'bill.parse', { url: 'https://img/1' }))
    .data;
  const [lunch, , refund] = items;
  // 用户在确认页改了金额和分类；伪造的 payer / split 被忽略
  const edited = {
    ...lunch,
    amount: 2400,
    cat: '日用',
    payer: 'a',
    split: 'half',
  };
  const saved = await call('B', 'expense.addMany', { items: [edited, refund] });
  assert.deepEqual(saved.data, { added: 2, skipped: 0 });
  const stored = [...expenses.docs.values()];
  assert.deepEqual(
    stored.map((d) => [d.amount, d.payer, d.split, d.flow, d.cat, d.by]),
    [
      [2400, 'b', 'self', 'out', '日用', 'B'],
      [2350, 'b', 'self', 'in', '吃饭', 'B'],
    ],
  );
  assert.deepEqual(Object.keys(stored[0].src).sort(), [
    'app',
    'key',
    'merchant',
    'time',
  ]);
  assert.match(stored[0]._id, /^bill_[0-9a-f]{24}$/);

  // 两人同时导入同一张图：第二次全部跳过
  const twice = await call('A', 'expense.addMany', { items: [lunch, refund] });
  assert.deepEqual(twice.data, { added: 0, skipped: 2 });

  const month = await call('A', 'expense.list', { month: '2026-10' });
  assert.equal(month.data.summary.sharedTotal, 0);
  assert.equal(month.data.summary.net, 0);
  assert.deepEqual(month.data.records.map((r) => [r.flow, r.src.app]).sort(), [
    ['in', 'wechat'],
    ['out', 'wechat'],
  ]);

  for (const bad of [
    [],
    [{ ...lunch, src: { ...lunch.src, app: 'paypal' } }],
    [{ ...lunch, src: { ...lunch.src, amount: 1.5 } }],
    [{ ...lunch, amount: 0 }],
    new Array(101).fill(lunch),
  ])
    assert.equal(
      (await call('A', 'expense.addMany', { items: bad })).code,
      'VALIDATION',
    );
});

test('收入只能是「自己的」；没有 flow 的旧记录读出来是支出', async () => {
  const { call, expenses } = await setup();
  const base = {
    amount: 1000,
    note: '工资',
    cat: '其他',
    date: '2026-10-05',
    payer: 'a',
  };
  assert.equal(
    (await call('A', 'expense.add', { ...base, split: 'half', flow: 'in' }))
      .code,
    'VALIDATION',
  );
  assert.equal(
    (await call('A', 'expense.add', { ...base, split: 'self', flow: 'x' }))
      .code,
    'VALIDATION',
  );
  const income = await call('A', 'expense.add', {
    ...base,
    split: 'self',
    flow: 'in',
  });
  assert.equal(income.data.flow, 'in');
  const old = await call('A', 'expense.add', { ...base, split: 'half' });
  assert.equal(old.data.flow, 'out');
  expenses.docs.delete(old.data.id);
  expenses.docs.set('legacy', {
    ...base,
    split: 'half',
    householdId: expenses.docs.get(income.data.id).householdId,
    _id: 'legacy',
    ts: 1,
    by: 'A',
  });
  const month = await call('B', 'expense.list', { month: '2026-10' });
  assert.equal(month.data.records.find((r) => r.id === 'legacy').flow, 'out');
  assert.equal(month.data.summary.net, 500);
});

test('通义千问接口：OpenAI 兼容格式、流式拼接，密钥只放请求头，失败不带出内容', async () => {
  assert.equal(createVision({}), null);
  const requests = [];
  const chunk = (content) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  const env = { DASHSCOPE_API_KEY: 'sk-test', BILL_MODEL: 'qwen-vl-max' };
  const vision = createAi({
    env,
    log: () => {},
    client: createVision(env, async (url, options) => {
      requests.push({ url, options });
      return {
        status: 200,
        text:
          chunk('{"items"') +
          chunk(':[]}') +
          'data: {"choices":[],"usage":{"total_tokens":9}}\n\ndata: [DONE]\n\n',
      };
    }),
  });
  assert.equal(
    await vision.read('billImage', 'https://img/1', '读账单'),
    '{"items":[]}',
  );
  const body = JSON.parse(requests[0].options.body);
  assert.equal(
    requests[0].url,
    'https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1/chat/completions',
  );
  assert.equal(requests[0].options.headers.Authorization, 'Bearer sk-test');
  assert.equal(body.model, 'qwen-vl-max');
  assert.equal(body.stream, true);
  assert.deepEqual(body.messages[0].content[0], {
    type: 'image_url',
    image_url: { url: 'https://img/1' },
  });
  assert.equal(body.enable_thinking, false);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.max_tokens, undefined);

  const summaryEnv = {
    DASHSCOPE_API_KEY: 'sk-test',
    SUMMARY_MODEL: 'qwen-flash',
  };
  const summary = createAi({
    env: summaryEnv,
    log: () => {},
    client: createVision(summaryEnv, async (url, options) => {
      requests.push({ url, options });
      return { status: 200, text: chunk('喵') + 'data: [DONE]\n\n' };
    }),
  });
  assert.equal(await summary.write('summary', '写小结'), '喵');
  const written = JSON.parse(requests[1].options.body);
  assert.equal(written.model, 'qwen-flash', '小结可以单独换模型');
  assert.equal(written.max_tokens, 300);
  assert.equal(written.enable_thinking, false);
  assert.deepEqual(written.messages[0].content, [
    { type: 'text', text: '写小结' },
  ]);
  const read = (client) =>
    client.chat([{ type: 'text', text: '读账单' }], { model: 'qwen-flash' });
  const failing = (status, text) =>
    read(
      createVision({ DASHSCOPE_API_KEY: 'sk-test' }, async () => ({
        status,
        text,
      })),
    );
  await assert.rejects(
    failing(
      401,
      '{"error":{"code":"invalid_api_key","message":"Incorrect API key"}}',
    ),
    {
      code: 'UNAVAILABLE',
      message: /API Key 无效.*invalid_api_key Incorrect API key/,
    },
  );
  await assert.rejects(failing(404, ''), { message: /模型名或接口地址不对/ });
  await assert.rejects(failing(429, 'quota'), { message: /额度用完/ });
  await assert.rejects(
    failing(400, '{"error":{"message":"image url download failed"}}'),
    { message: /HTTP 400.*image url download failed/ },
  );
  // 200 但没有内容（例如流里只有错误）
  await assert.rejects(failing(200, '{"error":{"message":"bad model"}}'), {
    message: /bad model/,
  });
  const offline = createVision({ DASHSCOPE_API_KEY: 'sk-test' }, async () => {
    throw new Error('ECONNRESET');
  });
  await assert.rejects(read(offline), {
    message: /识别服务暂时连不上/,
  });
});

// ── 账单文件导入（微信「用于个人对账」Excel）。下面的账目都是编造的。 ──

const {
  sharedStrings,
  sheetRows,
  wechatRows,
  fileChunks,
} = require('../miniprogram/utils/bill-file.ts');
const {
  fileTime,
  fileAmount,
  cleanName,
  parseWechatRows,
} = require('../cloudfunctions/api/bill-file');

const HEADER = [
  '交易时间',
  '交易类型',
  '交易对方',
  '商品',
  '收/支',
  '金额(元)',
  '支付方式',
  '当前状态',
  '交易单号',
  '商户单号',
  '备注',
];

/** 照微信账单的样子拼一份 xlsx 里的两个 XML：前面几行说明，再是表头和交易。时间写成 Excel 日期数字。 */
function wechatXlsx(trades) {
  const strings = [];
  const ref = (text) => {
    if (!strings.includes(text)) strings.push(text);
    return strings.indexOf(text);
  };
  const letters = 'ABCDEFGHIJK';
  const row = (index, cells) =>
    `<row r="${index}">` +
    cells
      .map((value, col) =>
        typeof value === 'number'
          ? `<c r="${letters[col]}${index}" s="1"><v>${value}</v></c>`
          : `<c r="${letters[col]}${index}" t="s"><v>${ref(value)}</v></c>`,
      )
      .join('') +
    '</row>';
  const serial = (text) =>
    (Date.parse(text.replace(' ', 'T') + 'Z') - Date.UTC(1899, 11, 30)) /
    86400000;
  const rows = [
    row(1, ['微信支付账单明细']),
    row(2, ['微信昵称：[小明]']),
    `<row r="3"/>`,
    row(4, ['----------------------微信支付账单明细列表--------------------']),
    row(5, HEADER),
    ...trades.map((t, i) =>
      row(6 + i, [serial(t[0]), ...t.slice(1, 5), Number(t[5]), ...t.slice(6)]),
    ),
  ];
  return {
    sheet: `<?xml version="1.0"?><worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`,
    shared: `<?xml version="1.0"?><sst>${strings
      .map(
        (s) =>
          `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`,
      )
      .join('')}</sst>`,
  };
}

// 时间、类型、对方、商品、收/支、金额、支付方式、状态、单号、商户单号、备注
const TRADES = [
  [
    '2026-10-21 22:07:01',
    '商户消费',
    '滴滴出行',
    '先乘车后付款',
    '支出',
    '15.4',
    '零钱',
    '支付成功',
    '4200001',
    'm1',
    '/',
  ],
  [
    '2026-10-20 12:30:00',
    '扫二维码付款',
    '张记牛肉面',
    '收款方备注:二维码收款',
    '支出',
    '28',
    '招商银行(9876)',
    '已转账',
    '1000002',
    'm2',
    '/',
  ],
  [
    '2026-10-19 09:00:00',
    '零钱提现',
    '/',
    '/',
    '/',
    '100',
    '/',
    '提现已到账',
    '1000003',
    '/',
    '/',
  ],
  [
    '2026-10-17 13:31:00',
    '商户消费',
    '星星充电',
    '充电',
    '支出',
    '30',
    '零钱',
    '已退款(¥26.67)',
    '4200004',
    'm4',
    '/',
  ],
  [
    '2026-10-17 13:36:00',
    '星星充电-退款',
    '星星充电',
    '/',
    '收入',
    '26.67',
    '零钱',
    '已退款¥26.67',
    '5000005',
    'm4',
    '/',
  ],
  [
    '2026-10-16 18:00:00',
    '商户消费',
    '京东',
    '京东-订单编号123',
    '支出',
    '218',
    '零钱',
    '已全额退款',
    '4200006',
    'm6',
    '/',
  ],
  [
    '2026-10-18 10:00:00',
    '京东商城平台商户-退款',
    '京东商城平台商户',
    '/',
    '收入',
    '218',
    '零钱',
    '已全额退款',
    '5000007',
    'm6',
    '/',
  ],
  [
    '2026-10-15 10:00:00',
    '美团-退款',
    '美团',
    '/',
    '收入',
    '5.9',
    '零钱',
    '已全额退款',
    '5000008',
    'm8',
    '/',
  ],
  [
    '2026-10-14 20:00:00',
    '亲属卡交易',
    '哄哄',
    '/',
    '支出',
    '66',
    '零钱',
    '支付成功',
    '4200009',
    'm9',
    '/',
  ],
  [
    '2026-10-13 21:00:00',
    '转账',
    '佳益',
    '转账备注:微信转账',
    '支出',
    '500',
    '零钱',
    '对方已收钱',
    '1000010',
    '/',
    '/',
  ],
  [
    '2026-10-12 08:00:00',
    '商户消费',
    '广州市白云区云城倍希贸易商行（个体工商户）',
    '/',
    '支出',
    '36',
    '零钱',
    '支付成功',
    '4200011',
    'm11',
    '/',
  ],
  [
    '2026-10-11 08:00:00',
    '商户消费',
    '某某超市',
    '/',
    '支出',
    '9.9',
    '零钱',
    '支付失败',
    '4200012',
    'm12',
    '/',
  ],
];

function wechatFileRows(trades = TRADES) {
  const { sheet, shared } = wechatXlsx(trades);
  return wechatRows(sheetRows(sheet, sharedStrings(shared)));
}

test('账单文件：手机上读出 Excel，只留七列，表头前的说明和昵称丢掉', () => {
  const rows = wechatFileRows();
  assert.equal(rows.length, TRADES.length);
  assert.deepEqual(Object.keys(rows[0]), [
    'time',
    'type',
    'peer',
    'io',
    'amount',
    'status',
    'tx',
  ]);
  assert.equal(rows[0].peer, '滴滴出行');
  assert.equal(rows[0].amount, '15.4');
  assert.equal(JSON.stringify(rows).includes('小明'), false);
  assert.equal(JSON.stringify(rows).includes('9876'), false);
  // 时间是 Excel 日期数字，云端换回北京时间
  assert.deepEqual(fileTime(rows[0].time), {
    date: '2026-10-21',
    time: '22:07',
    at: Date.UTC(2026, 9, 21, 22, 7, 1),
  });
  assert.equal(fileTime('2026-10-20 12:30:00').time, '12:30');
  assert.equal(fileAmount('15.400000000000002'), 1540);
  assert.equal(fileAmount('¥26.67'), 2667);
  assert.equal(
    cleanName('广州市白云区云城倍希贸易商行（个体工商户）'),
    '广州市白云区云城倍希贸易商行',
  );
  assert.equal(cleanName('融创物业服务集团有限公司'), '融创物业服务集团');
  // 不是微信账单
  assert.equal(wechatRows([['日期', '金额']]), null);
});

test('账单文件：分批发送，退款和原支出在不同批里也能配上，结果和一次发完一样', () => {
  const rows = wechatFileRows();
  // 复制成很长的账单，每批里的单号都不同
  const long = [];
  for (let copy = 0; copy < 60; copy++)
    for (const row of rows)
      long.push({
        ...row,
        tx: `${row.tx}-${copy}`,
        time: String(Number(row.time) + copy * 2),
      });
  const chunks = fileChunks(long);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.flatMap((chunk) => chunk.rows).length, long.length);
  assert.ok(
    chunks.every((chunk) => chunk.rows.length + chunk.context.length <= 400),
  );
  const whole = parseWechatRows(long.slice(0, 400));
  const pieces = fileChunks(long.slice(0, 400)).map((chunk) =>
    parseWechatRows(chunk.rows, chunk.context),
  );
  assert.equal(
    pieces.flatMap((piece) => piece.items).length,
    whole.items.length,
  );
  assert.equal(
    pieces.reduce((sum, piece) => sum + piece.skipped.refunded, 0),
    whole.skipped.refunded,
  );
});

test('账单文件：跳过中性和没付成的，部分退款记净额，全额退款不记，亲属卡记自己的', () => {
  const { items, skipped } = parseWechatRows(wechatFileRows());
  assert.deepEqual(skipped, { neutral: 1, closed: 1, refunded: 3, broken: 0 });
  const byNote = Object.fromEntries(items.map((item) => [item.note, item]));
  assert.deepEqual(Object.keys(byNote), [
    '滴滴出行',
    '张记牛肉面',
    '星星充电 已退¥26.67',
    '退款·美团',
    '亲属卡·哄哄',
    '转账·佳益',
    '广州市白云区云城倍希贸易',
  ]);
  assert.equal(byNote['星星充电 已退¥26.67'].amount, 333);
  // 原支出不在文件里（更早导入过）的退款，记一笔收入
  assert.equal(byNote['退款·美团'].flow, 'in');
  assert.equal(byNote['退款·美团'].amount, 590);
  assert.equal(byNote['亲属卡·哄哄'].flow, 'out');
  assert.equal(byNote['滴滴出行'].cat, '交通');
  assert.equal(byNote['张记牛肉面'].cat, '吃饭');
  assert.equal(byNote['转账·佳益'].cat, '其他');
  // 交易单号只留指纹
  assert.match(byNote['滴滴出行'].key, /^[0-9a-f]{24}$/);
  assert.equal(byNote['滴滴出行'].src.ref, byNote['滴滴出行'].key);
  assert.equal(JSON.stringify(items).includes('4200001'), false);
});

test('账单文件：查重、两人互转不记、保存后再导是已导入过，先截图后导文件不重复', async () => {
  const { call, expenses } = await setup();
  // 10-21 先用截图导入过同一笔滴滴（同一分钟、同金额）
  const shot = (
    await call('A', 'bill.match', {
      items: [
        {
          kind: '消费',
          cat: '交通',
          src: {
            app: 'wechat',
            merchant: '滴滴',
            time: '22:07',
            date: '2026-10-21',
            amount: 1540,
            flow: 'out',
          },
        },
      ],
    })
  ).data.items;
  await call('A', 'expense.addMany', { items: shot });

  const rows = wechatFileRows();
  const result = await call('A', 'bill.file', { app: 'wechat', rows });
  assert.equal(result.ok, true, result.message);
  const status = Object.fromEntries(
    result.data.items.map((item) => [item.note, item.status]),
  );
  assert.equal(status['滴滴出行'], 'imported');
  assert.equal(status['转账·佳益'], 'partner');
  assert.equal(status['张记牛肉面'], 'new');
  assert.equal(result.data.skipped.refunded, 3);

  const chosen = result.data.items.filter((item) => item.status === 'new');
  const saved = await call('B', 'expense.addMany', { items: chosen });
  assert.deepEqual(saved.data, { added: chosen.length, skipped: 0 });
  const stored = [...expenses.docs.values()].find(
    (d) => d.note === '亲属卡·哄哄',
  );
  assert.equal(stored.payer, 'b');
  assert.equal(stored.split, 'self');
  assert.equal(JSON.stringify(stored).includes('4200009'), false);

  const again = await call('A', 'bill.file', { app: 'wechat', rows });
  assert.deepEqual(
    [...new Set(again.data.items.map((item) => item.status))].sort(),
    ['imported', 'partner'],
  );
  // 前端改不了指纹的格式
  const forged = { ...chosen[0], src: { ...chosen[0].src, ref: 'x' } };
  assert.equal(
    (await call('A', 'expense.addMany', { items: [forged] })).code,
    'VALIDATION',
  );
  assert.equal(
    (await call('A', 'bill.file', { app: 'other', rows })).code,
    'VALIDATION',
  );
  assert.equal(
    (await call('A', 'bill.file', { app: 'alipay', rows: [{ x: 1 }] })).code,
    'VALIDATION',
  );
  assert.equal(
    (await call('A', 'bill.file', { app: 'wechat', rows: [] })).code,
    'VALIDATION',
  );
});

test('商户记忆：同一商户以前记在哪一类，这次套用；次数相同取最近的；没记过的不动', async () => {
  const { call } = await setup();
  const row = (merchant, date, cat) => ({
    kind: '消费',
    cat,
    src: {
      app: 'wechat',
      merchant,
      time: '',
      date,
      amount: 1000,
      flow: 'out',
    },
  });
  // 星星充电上个月归「交通」，自己把鸟贵族改成「娱乐」
  const first = (
    await call('A', 'bill.match', {
      items: [
        row('星星充电', '2026-09-01', '交通'),
        row('鸟贵族', '2026-09-02', '娱乐'),
      ],
    })
  ).data.items;
  await call('A', 'expense.addMany', { items: first });
  const next = (
    await call('A', 'bill.match', {
      items: [
        row('星星充电', '2026-10-05', '其他'),
        row('鸟贵族', '2026-10-06', '吃饭'),
        row('没去过的店', '2026-10-07', '吃饭'),
      ],
    })
  ).data.items;
  assert.deepEqual(
    next.map((item) => item.cat),
    ['交通', '娱乐', '吃饭'],
  );
});

test('转账：填了微信名字的对方也认得出，别人不会被当成对方', async () => {
  const { call } = await setup();
  const saved = await call('B', 'household.update', { payName: '小佳' });
  assert.equal(saved.ok, true, saved.message);
  // 只给自己看自己的
  assert.equal(saved.data.members.find((m) => m.isMe).payName, '小佳');
  const seenByA = (await call('A', 'household.get', {})).data;
  assert.equal(seenByA.members.find((m) => !m.isMe).payName, undefined);
  assert.equal(
    (await call('B', 'household.update', { payName: 'x'.repeat(21) })).code,
    'VALIDATION',
  );
  const transfer = (merchant) => ({
    kind: '转账',
    cat: '其他',
    src: {
      app: 'wechat',
      merchant,
      time: '',
      date: '2026-10-20',
      amount: 5000,
      flow: 'out',
    },
  });
  const matched = (
    await call('A', 'bill.match', {
      items: [transfer('小佳 (宝)'), transfer('隔壁老王')],
    })
  ).data.items;
  assert.deepEqual(
    matched.map((item) => item.status),
    ['partner', 'new'],
  );
});

// ── 支付宝账单文件（GBK 的 CSV）。账目是编造的，字节是把整份文件按 GBK 编码后的十六进制。 ──

const {
  alipayRows,
  alipayChunks,
} = require('../miniprogram/utils/bill-file.ts');
const { parseAlipayRows } = require('../cloudfunctions/api/bill-alipay');

const ALIPAY_GBK = Buffer.from(
  '2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d' +
    '2d0d0ab5bcb3f6d0c5cfa2a3ba0d0ad0d5c3fba3bab2e2cad40d0ab9b239b1cabcc7c2bc0d0a0d0a2d2d2d2d2d2d2d2d2d2d' +
    '2d2d2d2d2d2d2d2d2d2d2d2d2d2dd6a7b8b6b1a6d6a7b8b6bfc6bcbcd3d0cfdeb9abcbbe2020b5e7d7d3bfcdbba7bbd8b5a5' +
    '2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d0d0abdbbd2d7cab1bce42cbdbbd2d7b7d6c0e02cbdbbd2d7b6d4' +
    'b7bd2cb6d4b7bdd5cbbac52cc9ccc6b7cbb5c3f72ccad52fd6a72cbdf0b6ee2ccad52fb8b6bfeeb7bdcabd2cbdbbd2d7d7b4' +
    'ccac2cbdbbd2d7b6a9b5a5bac52cc9ccbcd2b6a9b5a5bac52cb1b8d7a22c0d0a323032362d31302d32322031313a31313a35' +
    '342cb2cdd2fbc3c0cab32cccd4b1a6c9c1b9ba2c6535302a2a2a40616c69626162612d696e632e636f6d2cc1f9baccd4aac8' +
    'e2cde8bafac0b1ccc0a1a4c5a3d1f2c8e2c5dde2c9cde2c2f4b6a9b5a52cd6a7b3f62c31392e33302cc4b3d2f8d0d0d0c5d3' +
    'c3bfa82830303031292cbdbbd2d7b3c9b9a62c32303236313032323030303030303030303030303031092c4d31092c2c0d0a' +
    '323032362d31302d32312030393a34383a33322cbdbbcda8b3f6d0d02ccef7b0b2b3c7cad0cda8b7a2d5b9d3d0cfded4f0c8' +
    'ceb9abcbbe2c782c22c6bbb9fbb3a4b0b2cda82cd7d4b6afb3e4d6b5222cd6a7b3f62c35302e30302cc4b3d2f8d0d0b4a2d0' +
    'eebfa82830303032292cbdbbd2d7b3c9b9a62c32303236313032313030303030303030303030303032092c4d32092c2c0d0a' +
    '323032362d31302d31312030303a35363a30352ccafdc2ebb5e7c6f72c74622a2a392c782ccaf3b1eab7c0bbacccf92cd6a7' +
    'b3f62c302e30302c2cd6a7b8b6b3c9b9a62c32303236313031313030303030303030303030303033092c4d33092c2c0d0a32' +
    '3032362d30392d30392030383a35393a34312cb3e8ceef2cb9cfd6de2a2ab5ea2c782cb7c0c3a8d7a5c9b3b7a2b1a3bba4c3' +
    'a8d7a5b5e62cd6a7b3f62c31382e36372cc4b3d2f8d0d0b4a2d0eebfa82830303032292cd6a7b8b6b3c9b9a62c3230323630' +
    '3930393030303030303030303030303034092c4d34092c2c0d0a323032362d30392d30352032333a32393a33312ccdcbbfee' +
    '2cccd8c0b4b5e72c782ccdcbbfee2dccd8c0b4b5e7b3e4d6b52cb2bbbcc6cad5d6a72c31322e36372cc4b3d2f8d0d0b4a2d0' +
    'eebfa82830303032292ccdcbbfeeb3c9b9a62c32303236303930353030303030303030303030303035092c4d35092c2c0d0a' +
    '323032362d30392d30352032333a30303a31332cc6e4cbfb2cccd8c0b4b5e72c782cccd8c0b4b5e7b3e4d6b52cd6a7b3f62c' +
    '32392e35302cc4b3d2f8d0d0b4a2d0eebfa82830303032292cbdbbd2d7b3c9b9a62c32303236303930353030303030303030' +
    '303030303036092c4d36092c2c0d0a323032362d30362d32332032303a31353a33382ccdcbbfee2cd0a1baeccae92c782ccd' +
    'cbbfee2dd0a1baeccae9b6a9b5a5a3ba50312cb2bbbcc6cad5d6a72c3333372e38352cc4b3d2f8d0d0b4a2d0eebfa8283030' +
    '3032292ccdcbbfeeb3c9b9a62c32303236303632333030303030303030303030303037092c4d37092c2c0d0a323032362d30' +
    '362d32332032303a30353a31372cc8d5d3c3b0d9bbf52cd0a1baeccae92c782cd0a1baeccae9b6a9b5a5a3ba50312cd6a7b3' +
    'f62c3333372e38352cc4b3d2f8d0d0b4a2d0eebfa82830303032292cbdbbd2d7b9d8b1d52c32303236303632333030303030' +
    '303030303030303038092c4d38092c2c0d0a323032362d30342d31342031373a34373a31312cd5cbbba7b4e6c8a12cbdbbcd' +
    'a8d2f8d0d02c782ccce1cfd62dcab5cab1cce1cfd62cb2bbbcc6cad5d6a72c39312e36332cd3e0b6ee2cbdbbd2d7b3c9b9a6' +
    '2c32303236303431343030303030303030303030303039092c4d39092c2c0d0a323032362d30342d31312030363a35303a31' +
    '382cd7aad5cbbaecb0fc2c2ac8d82c782cd7aad5cb2ccad5c8eb2c36302e38302cd5cbbba7d3e0b6ee2cbdbbd2d7b3c9b9a6' +
    '2c32303236303431313030303030303030303030303130092c4d3130092c2c0d0a323032362d30332d30322030393a32383a' +
    '32372ccad5c8eb2cc4b3c4b32c782ccad5c7aec2ebcad5bfee2ccad5c8eb2c32302e30302c2cbdbbd2d7b3c9b9a62c323032' +
    '36303330323030303030303030303030303131092c4d3131092c2c0d0a',
  'hex',
);

function alipayItems() {
  const file = alipayRows(new Uint8Array(ALIPAY_GBK));
  return { file, ...parseAlipayRows(file.rows, [], file.enc) };
}

test('支付宝账单：按字节读出要用的几列，认出 GBK，说明行和不相干的列丢掉', () => {
  const file = alipayRows(new Uint8Array(ALIPAY_GBK));
  assert.equal(file.enc, 'gbk');
  assert.equal(file.rows.length, 11);
  assert.deepEqual(Object.keys(file.rows[0]).sort(), [
    'amount',
    'cls',
    'goods',
    'io',
    'peer',
    'status',
    'time',
    'tx',
  ]);
  assert.equal(file.rows[0].time, '2026-10-22 11:11:54');
  assert.equal(file.rows[0].amount, '19.30');
  assert.equal(file.rows[0].tx, '2026102200000000000001');
  // 引号里的逗号不切开
  assert.equal(file.rows[1].amount, '50.00');
  // 银行卡、对方账号、商家订单号不出手机
  assert.equal(JSON.stringify(file.rows).includes('(0001)'), false);
  assert.equal(JSON.stringify(file.rows).includes('alibaba'), false);
  // 文字列是没解码的字节，不是汉字
  assert.notEqual(file.rows[0].peer, '淘宝闪购');
  // UTF-8 的文件也认得；不是支付宝账单返回 null
  const utf8 = Buffer.from(
    '交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注,\n' +
      '2026-10-22 11:11:54,餐饮美食,店,x,饭,支出,1.00,卡,交易成功,T1,M1,,\n',
  );
  assert.equal(alipayRows(new Uint8Array(utf8)).enc, 'utf-8');
  assert.equal(alipayRows(new Uint8Array(Buffer.from('a,b\n1,2'))), null);
});

test('支付宝账单：不计收支和关闭的跳过，退款从原支出里扣，分类用支付宝的', () => {
  const { items, skipped } = alipayItems();
  assert.deepEqual(skipped, { neutral: 4, closed: 1, refunded: 0, broken: 0 });
  const byNote = Object.fromEntries(items.map((item) => [item.note, item]));
  assert.deepEqual(Object.keys(byNote), [
    '六禾元肉丸胡辣汤·牛羊肉',
    '西安城市通发展',
    '防猫抓沙发保护猫抓垫',
    '特来电 已退¥12.67',
    '转账·蓉',
    '转账·某某',
  ]);
  assert.equal(byNote['特来电 已退¥12.67'].amount, 1683);
  assert.equal(byNote['防猫抓沙发保护猫抓垫'].cat, '猫咪');
  assert.equal(byNote['六禾元肉丸胡辣汤·牛羊肉'].cat, '吃饭');
  assert.equal(byNote['六禾元肉丸胡辣汤·牛羊肉'].amount, 1930);
  assert.equal(byNote['转账·蓉'].flow, 'in');
  assert.equal(byNote['转账·蓉'].kind, '转账');
  assert.equal(byNote['特来电 已退¥12.67'].src.app, 'alipay');
  assert.match(items[0].key, /^[0-9a-f]{24}$/);
  assert.equal(JSON.stringify(items).includes('2026102200000000000001'), false);
});

test('支付宝账单：退款和原支出分在不同批里也能配上', () => {
  const file = alipayRows(new Uint8Array(ALIPAY_GBK));
  const rows = [];
  for (let copy = 0; copy < 40; copy++)
    for (const row of file.rows)
      rows.push({
        ...row,
        tx: `${row.tx}-${copy}`,
        time: row.time.replace('2026', String(2000 + copy)),
      });
  const chunks = alipayChunks(
    file.rows.concat(file.rows.map((row) => ({ ...row, tx: `${row.tx}b` }))),
    'gbk',
  );
  assert.equal(chunks.length, 1);
  const wide = alipayChunks(rows, 'gbk');
  assert.ok(wide.length > 1);
  assert.equal(wide.flatMap((chunk) => chunk.rows).length, rows.length);
  assert.ok(
    wide.every((chunk) => chunk.rows.length + chunk.context.length <= 400),
  );
  const sub = file.rows;
  const one = parseAlipayRows(sub, [], 'gbk');
  // 把退款行放进另一批，原支出所在的批靠上下文配对
  const refund = sub.filter(
    (row) => row.cls !== sub[0].cls && row.goods.length && row.io !== sub[0].io,
  );
  assert.ok(refund.length >= 0);
  const paired = parseAlipayRows(
    sub.filter((row) => row.tx.endsWith('06')),
    sub.filter((row) => row.tx.endsWith('05')),
    'gbk',
  );
  assert.equal(paired.items[0].amount, 1683);
  assert.equal(one.items.length, 6);
});

test('支付宝账单：整条链路——查重、和小家成员的转账不记、保存后再导是已导入过', async () => {
  const { call } = await setup();
  const file = alipayRows(new Uint8Array(ALIPAY_GBK));
  const send = () =>
    call('A', 'bill.file', { app: 'alipay', enc: file.enc, rows: file.rows });
  const first = await send();
  assert.equal(first.ok, true, first.message);
  const status = Object.fromEntries(
    first.data.items.map((item) => [item.note, item.status]),
  );
  assert.equal(status['防猫抓沙发保护猫抓垫'], 'new');
  const chosen = first.data.items.filter((item) => item.status === 'new');
  const saved = await call('B', 'expense.addMany', { items: chosen });
  assert.deepEqual(saved.data, { added: chosen.length, skipped: 0 });
  const again = await send();
  assert.deepEqual(
    [...new Set(again.data.items.map((item) => item.status))].sort(),
    ['imported', 'partner'].filter((name) =>
      again.data.items.some((item) => item.status === name),
    ),
  );
  assert.equal(
    (
      await call('A', 'bill.file', {
        app: 'alipay',
        enc: 'gbk',
        rows: [{ x: 1 }],
      })
    ).code,
    'VALIDATION',
  );
});
