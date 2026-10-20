# 小家

超凡和佳益两个人共用的微信小程序：记账、清单、吃啥、周末、纪念。由答谢宴小程序改造而来，方案见 [docs/PLAN.md](docs/PLAN.md)，阶段 0 调查与决定见 [docs/STAGE-0-REPORT.md](docs/STAGE-0-REPORT.md)。

只通过体验版给两个人使用，不对外发布，不做支付。

## 当前进度

- 阶段 1（已验收）：5 个 tab、创建 / 用邀请码加入小家、「纪念」页成员与设置、答谢宴登记与祝福只读归档。
- 阶段 2：
  - 记账（M1–M3）：记一笔（整数日元、9 个分类、日期、付款人、分摊方式）、按月汇总与结算建议、记为已结算（删除结算记录即撤销）、编辑与删除。
  - 清单（T1–T2）：购物 / 待办 / 家务，指派给某人或一起，勾选、编辑、删除。
  - 导出（G2）：「纪念」→「复制全部数据」，复制为带版本号的 JSON。
- 阶段 3：
  - 吃啥（F1）：菜单增删改（在家做 / 外食 / 外卖），按类型筛选后随机抽一个，尽量不连续抽到同一道。
  - 周末（W1）：收藏想去的地方（地点、理由、计划），可编辑删除。
  - 纪念日（D1）：在「纪念」页，倒数天数，可每年重复（显示第几年）；不重复且已过的显示「已经 N 天」。
  - AI 占位：云函数 `ai-suggest` 始终返回 `{ disabled: true, items: [] }`，页面据此隐藏「让 AI 推荐」与周末条件筛选。
- 导出包含记账、清单、菜单、周末收藏、纪念日。

### 方案之外的约定

- 纪念日 2 月 29 日在平年按 2 月 28 日计算。
- `ai-suggest` 额外接受 `probe: true`：只回答是否可用、不生成内容，小程序进入「吃啥」「周末」时用它决定是否显示 AI 按钮。函数未部署或调用失败时同样视为不可用。
- 周末的「条件筛选」（时长、心情、预算、交通）是给 AI 的输入，AI 不可用时与按钮一起隐藏。

### 记账规则的落地细节

- 共同支出排除「结算」和「自己的」；结算建议的 net 也不计「自己的」，但计入结算记录，因此结算后 net 归零。
- 结算记录的日期：结算当月为今天，结算过去月份时为该月最后一天，保证落在该月内。
- 结算记录不能编辑，只能删除（即撤销结算）。

## 架构

```
小程序（TypeScript，开发者工具 typescript 编译插件）
   │ wx.cloud.callFunction({ name: 'api' })
   ▼
云函数 api：所有读写的唯一入口，按 openid 校验 household 成员
云函数 ai-suggest：AI 接口占位，暂时总是 disabled
   ▼
CloudBase 数据库：所有集合禁止客户端直接读写
```

- `cloudfunctions/api/router.js`：action 分发；`household.js`：小家；`expenses.js` + `ledger.js`：记账与结算规则；`todos.js`：清单；`export.js`：导出；`collections.js` + `crud.js`：吃啥、周末、纪念日；`anniversary.js`：纪念日倒数；`archive.js`：答谢宴归档只读。
- 每条业务记录都带 `householdId`、`ts`、`by`（openid），读写都限定在本小家内。
- 返回给小程序的数据不包含 openid。
- 日期按中国时区（UTC+8）展示。

## 使用

1. 在微信开发者工具打开 `D:\chaofan\weixinlittleprogram`（不要只打开 `miniprogram`）。
2. `miniprogram/config/local.ts` 填写云环境 ID（干净副本先运行 `npm ci`、`npm run setup`）。
3. 云端准备见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 常用命令

```powershell
npm run check          # TypeScript、ESLint、自动测试
npm run check:native   # 本机微信 WXML/WXSS 编译器检查（需要 Windows 上的开发者工具）
```

旧的答谢宴文档保存在 [docs/legacy-wedding](docs/legacy-wedding/)，仅供参考。
