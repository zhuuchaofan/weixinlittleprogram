# 小家

超凡和佳益两个人共用的微信小程序：记账、清单、吃啥、周末、纪念。由答谢宴小程序改造而来，方案见 [docs/PLAN.md](docs/PLAN.md)，阶段 0 调查与决定见 [docs/STAGE-0-REPORT.md](docs/STAGE-0-REPORT.md)。

只通过体验版给两个人使用，不对外发布，不做支付。

## 当前进度

阶段 1：骨架与绑定（G1）。

- 5 个 tab：记账、清单、吃啥、周末、纪念。前四个暂为占位。
- 创建小家（生成 6 位邀请码）、用邀请码加入（最多 2 人，满员后邀请码失效）。
- 「纪念」页：成员、邀请码、修改称呼和城市；入口「答谢宴 · 登记与祝福」只读归档。

## 架构

```
小程序（TypeScript，开发者工具 typescript 编译插件）
   │ wx.cloud.callFunction({ name: 'api' })
   ▼
云函数 api：所有读写的唯一入口，按 openid 校验 household 成员
   ▼
CloudBase 数据库：所有集合禁止客户端直接读写
```

- `cloudfunctions/api/router.js`：action 分发；`household.js`：创建、加入、读取、修改；`archive.js`：答谢宴归档只读。
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
