# 小家

超凡和佳益两个人共用的微信小程序「喵喵记一笔」（原名「球球布丁家属院」）：记账、清单、吃啥、想去、纪念日。由答谢宴小程序改造而来。不做支付。

- 数据模型、记账规则、功能编号：[docs/PLAN.md](docs/PLAN.md)
- 接下来做什么：[docs/ROADMAP.md](docs/ROADMAP.md)
- 云端部署与每次改动的验收步骤：[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- 界面设计规范（颜色、间距、按钮）：[docs/DESIGN.md](docs/DESIGN.md)

## 功能

- 通用：创建小家、用邀请码加入（最多两人）；没有底部 tab，打开是主页（两人与下一个纪念日、本月支出、「记一笔」「截图记账」、清单 / 吃啥 / 想去 / 纪念日四个入口），各功能从主页点进去、左上角返回；各页下拉刷新；主页右上角设置：成员与称呼、「两人分摊与结算」开关、复制全部数据（带版本号的 JSON，含 `counts`）。
- 记账：记一笔（人民币，以「分」为整数存储；支出 / 收入；9 个分类、日期、付款人）；按月汇总与「按分类」；两人都能改对方的账，改过的留痕。「两人分摊与结算」默认关闭，只记账；打开后有怎么分（平摊 / 全算对方 / 自己的 / 按比例）、结算建议和「记为已结算」。
- 截图记账：选微信 / 支付宝账单列表截图，千问识别、查重，确认后导入（全算自己的）。
- 清单：购物 / 待办两类（旧的「家务」显示在待办里），顶部输入框直接添加，默认「一起」，可在详情里指派给某人；已完成折叠，购物里买过的点一下加回清单；清除已完成。
- 吃啥：按「怎么吃」（在家做 / 出去吃 / 外卖）一排筛选，随机抽一个，「就吃这个」记下吃过的日期，抽签避开最近 3 天吃过的。不再区分菜品和店家（旧数据的 kind 保留不显示）。
- 想去（原「周末」）：想去的地方和想做的事，顶部直接添加，一栏备注；打勾「去过了」记下日期，去过的折叠在下面。
- 纪念日：最近一个放在顶部大卡片；倒数，可每年重复（显示几周年），不重复且已过的显示「已经 N 天」；答谢宴登记与祝福只读归档（只有标记过的小家可见）。

### 约定

- 纪念日 2 月 29 日在平年按 2 月 28 日计算。
- 截图识别每个小家每天最多 5 张（会员 100 张）（两人合计，`shared/contract.json` 的 `billImport.dailyImages`），识别失败也算一次。
- 各页的列表在本机存一份快照，打开小程序先显示快照再从云端更新；回到主页时只有本机改过数据或超过 60 秒才重新读，下拉刷新总是重新读（`miniprogram/services/snapshot.ts`）。
- 主题：5 套配色在 `miniprogram/config/themes.ts`（默认香芋紫），每套是一组 CSS 变量；各页 wxml 顶部 `<page-meta page-style>` 套用，`services/theme.ts` 的 `applyTheme` 在 onShow 里刷新。设置页可切换，存在本机。页面样式里不要写死主色，用 `--accent`、`--accent-grad`、`--glow`、`--ring` 等变量。
- 跟主色走的图标（主页四个入口、截图记账小猫、礼物）原图在 `assets/theme-src/`，改了图标或主题后运行 `python3 scripts/theme-icons.py`（需要 Pillow）生成 `miniprogram/images/themes/<主题>/`。

### 记账规则的落地细节

- 金额单位为「分」：方案里的「整数日元」改为人民币后，仍按整数存储，结算金额四舍五入到分，|net| < 1 分视为已结清。
- 共同支出排除「结算」和「自己的」；结算建议的 net 也不计「自己的」，但计入结算记录，因此结算后 net 归零。
- 结算记录的日期：结算当月为今天，结算过去月份时为该月最后一天，保证落在该月内。
- 分类「食费」已改名为「吃饭」：数据库里的旧记录不迁移，读出、统计、导出时自动当作「吃饭」，保存时存成新名称；`shared/contract.json` 的 `categoryAliases` 记录这类改名。
- 两人对所有账目权限相同，谁都能改、能删；改过的账目记下最后一次修改的人和时间（`editedBy`、`editedAt`，对外只返回角色）。明细里对方改过的账目显示「某某改过」，账目编辑页显示「某某修改于 …」，导出里带 `editedAt`、`editedByRole`。删除不留记录。
- 按比例分摊的 credit = round(金额 × (100 − 比例) / 100)，四舍五入到分（恰好半分进位）；比例 0 等同「全算对方」，100 不产生欠款但仍计入共同支出。
- 结算记录不能编辑，只能删除（即撤销结算）。
- 结算记录的 `_id` 是确定的：`settle_<月份>_<小家 id 与该月全部记录 id 排序后的 SHA-256 前 24 位>`。两人同时结算时只有一条插入成功，另一人收到「本月已经结清了」并刷新；撤销后账目回到原样，可用同一 `_id` 重新结算。

## 架构

```
小程序（TypeScript，开发者工具 typescript 编译插件）
   │ wx.cloud.callFunction({ name: 'api' })
   ▼
云函数 api：所有读写的唯一入口，按 openid 校验 household 成员
   ▼
CloudBase 数据库：所有集合禁止客户端直接读写
```

- 小程序端：`pages/` 只管显示和交互，`pages/<列表>/` 与编辑页一一对应（`wishes` ↔ `wish-edit`、`dates` ↔ `date-edit` …）；`services/` 是调用 `api` 的封装（`collections.ts` 里清单、吃啥、想去、纪念日共用 `collection.ts` 的通用写法，`page-load.ts` 是各页共用的「确认小家 → 读云端 → 显示」流程）；`config/` 是取值和主题；`utils/` 是日期、金额等纯函数。
- `cloudfunctions/api/router.js`：action 分发；`household.js`：小家；`expenses.js` + `ledger.js`：记账与结算规则；`todos.js`：清单；`export.js`：导出；`collections.js` + `crud.js`：吃啥、想去、纪念日；`bills.js` + `bill-parse.js` + `bill-match.js` + `vision.js`：截图记账（解析、查重、调用千问）；`anniversary.js`：纪念日倒数；`archive.js`：答谢宴归档只读。
- 每条业务记录都带 `householdId`、`ts`、`by`（openid），读写都限定在本小家内。
- 返回给小程序的数据不包含 openid。
- 日期按中国时区（UTC+8）展示。
- 分类、标签、字段长度等前后端共用的规则只在 `shared/contract.json` 写一份，副本由 `npm run contract` 生成（`cloudfunctions/api/contract.json`、`miniprogram/config/contract.ts`），测试会发现漏同步。
- 日常读取（列表、按月账目）超过 2000 条时返回 `TOO_MANY`，不会静默少数据；导出按 `count()` 读完整，结果带各集合 `counts`。

## 使用

1. 在微信开发者工具打开 `D:\chaofan\weixinlittleprogram`（不要只打开 `miniprogram`）。
2. `miniprogram/config/local.ts` 填写云环境 ID（干净副本先运行 `npm ci`、`npm run setup`）。
3. 云端准备见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 常用命令

```powershell
npm run setup          # 干净副本：生成本地配置、同步契约、安装云函数依赖（SDK 测试需要）
npm run contract       # 改了 shared/contract.json 之后运行，同步到云函数与小程序
npm run check          # TypeScript、ESLint、自动测试
npm run check:native   # 本机微信 WXML/WXSS 编译器检查（需要 Windows 上的开发者工具）
```
