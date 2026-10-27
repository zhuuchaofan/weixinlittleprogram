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
    message: /连不上识别服务/,
  });
});

// ── 账单文件导入（微信「用于个人对账」Excel）。下面的账目都是编造的。 ──

const {
  sharedStrings,
  sheetRows,
  wechatRows,
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
    (await call('A', 'bill.file', { app: 'alipay', rows })).code,
    'VALIDATION',
  );
  assert.equal(
    (await call('A', 'bill.file', { app: 'wechat', rows: [] })).code,
    'VALIDATION',
  );
});
