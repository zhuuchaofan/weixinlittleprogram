# 阶段 0 调查报告：答谢宴小程序 → 小家

调查日期：2026-10-20　对象：`D:\chaofan\weixinlittleprogram`（`master` 最新提交 `85d27af`）

> 更新：原 CloudBase 环境已续费，环境 ID 和数据（`rsvps`、`guest_messages`、`photo_content`、`event_program`、云存储 `wedding/`）都还在。之前在 `feature/couple-app` 上删除登记/祝福的改动已全部撤回，工作区与 `master` 一致（仅剩原有的换行符差异），`npm run check` 73 项通过。

## 1. 目录结构

```
weixinlittleprogram/
├─ miniprogram/            小程序（TypeScript，开发者工具 typescript 编译插件）
│  ├─ app.ts / app.json / app.wxss
│  ├─ pages/               10 个页面（见第 2 节）
│  ├─ components/          6 个组件
│  ├─ services/            云调用、照片、媒体上传、mock、音乐等 24 个文件
│  ├─ config/              content.ts（婚宴内容）、ui-copy.ts（全部文案）、local*.ts（环境）、image/music
│  ├─ utils/               日期、宴会阶段、收集截止、校验、预览、导航
│  └─ models.ts
├─ cloudfunctions/
│  ├─ weddingApi/          唯一云函数（7 个模块）
│  └─ database.rules.json  规则模板 { read:false, write:false }
├─ scripts/                setup、本地浏览器预览、原生编译检查、UI 回归（Playwright + Edge）
├─ tests/                  node:test，73 项，master 上全部通过
├─ docs/                   14 份文档
└─ artifacts/              截图、日志、恢复用的临时文件（未被代码引用）
```

## 2. 页面清单与建议

| 页面       | 作用                                   | 建议                                                                          |
| ---------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| home       | 宴会倒计时、封面照、猫咪、目录         | **改造**：变成「小家」入口页（未绑定时显示创建/加入），或移除并由 tabBar 接管 |
| invitation | 电子请柬、地图导航                     | **移除**（或作为回忆里的一条只读内容）                                        |
| story      | 故事时间线（内容写死在 content.ts）    | **并入 D2 回忆**，或移除                                                      |
| gallery    | 照片册（四类相册、视频）               | 待你决定：并入「纪念」tab 或移除                                              |
| rsvp       | 到场登记                               | **保留为只读归档**：放进「纪念」tab，展示已有登记，不再收集                   |
| guestbook  | 私密祝福                               | **保留为只读归档**：同上，只给两人看                                          |
| admin      | 主人工作台（登记统计 + 照片/流程入口） | **移除**（成员身份改由 household 判断）                                       |
| photos     | 照片管理（上传、草稿、发布、安全删除） | 待定：保留上传链路给 D3「回忆添加照片」复用，页面本身移除                     |
| program    | 当天流程编辑                           | **移除**                                                                      |
| privacy    | 隐私说明、减少动效开关                 | **改造**：改写为小家的隐私说明                                                |

组件：`photo-frame`、`media-video`、`page-back-link`、`page-footer` 可复用；`music-control`、`editor-action-bar` 建议移除或视情况保留。

## 3. 云函数 `weddingApi`

单一入口，按 `action` 分发到 4 个处理器：

| 模块                                           | action                                                                                                                                            | 建议                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| photos.js / media-library.js / image-upload.js | getAccess、getPhotos、getMediaLibrary(Draft)、save/publish…、prepare/verifyImageUpload、prepare/verifyVideoUpload、inspect/deleteManagedPhotoFile | 上传签名与校验逻辑可抽出给 D3 复用；相册草稿/发布模型不复用 |
| event-program.js                               | get/save/publishEventProgram(Draft)                                                                                                               | 移除                                                        |
| guestbook.js                                   | guestbookGetMine/Save/RemoveMine/Dashboard                                                                                                        | 移除                                                        |
| core.js                                        | getMine、save、removeMine、dashboard（登记）                                                                                                      | 移除                                                        |
| invocation.js                                  | 从 context 解析 OpenID 与环境 ID、SDK 初始化（CLOUD_API 通道）                                                                                    | **复用**，新 `api` 云函数直接沿用                           |

鉴权：管理员白名单来自环境变量 `ADMIN_OPENIDS`；访客只能操作自己的记录（文档 ID = sha256(openid)）。

## 4. CloudBase 环境 ID 出现的位置

| 位置                                      | 内容                                                                        | 处理                 |
| ----------------------------------------- | --------------------------------------------------------------------------- | -------------------- |
| `miniprogram/config/local.ts:7`           | `cloudEnvId: 'cloud1-d1grwmf5a71be2fa7'`（已续费，仍有效）                  | 不用改               |
| `miniprogram/config/content.ts:47、50`    | 婚纱照 `cloud://cloud1-d1grwmf5a71be2fa7…/wedding/original/` 写死的 File ID | 文件仍在，可继续使用 |
| `miniprogram/services/media-upload.ts:42` | 本地暂存 key 拼接了 envId                                                   | 无需改               |
| `local.example.ts`、`local.preview.ts`    | 空值 / `preview-only`                                                       | 无需改               |
| `app.ts:6`                                | `mode === 'cloud'` 时才初始化云                                             | 复用                 |

## 5. 依赖与基础库

- 基础库 `libVersion: 3.17.3`（project.private.config.json）；未开启 Skyline。
- 小程序端**没有**运行时 npm 依赖，不需要「构建 npm」。
- 云函数依赖：`@cloudbase/js-sdk@3.10.1`、`@cloudbase/signature-nodejs@2.0.0`（不是 `wx-server-sdk`）。
- 开发依赖：TypeScript 5.9、ESLint 9、Prettier 3、esbuild、Playwright、miniprogram-api-typings。
- Node：本机 VM 为 v22；`check:native`、`test:ui` 依赖 Windows 上的微信开发者工具编译器和 Edge。

## 6. 可复用 / 建议移除

**可复用**

- 工程化：`npm run check`（tsc + eslint + node:test）、prettier、本地浏览器预览、UI 回归脚本框架。
- `services/cloud.ts`（统一调用、错误分类、诊断脱敏）、`services/access.ts`（短时缓存的身份判断，可改成「是否已绑定小家」）。
- mock 模式（`localConfig.mode = 'mock'`）：没有云环境时也能在本地完整跑页面，建议每个新功能都配 mock。
- `utils/date.ts`、`utils/event-phase.ts`（UTC+8 日历日计算，纪念日倒数可借鉴，但需改为日本时区 UTC+9）。
- 云函数 `invocation.js`、图片/视频上传签名链路（给 D3）。
- 组件 `photo-frame`、`page-back-link`、`page-footer`；`app.wxss` 的设计变量。

**建议移除**

- 页面：admin、program；invitation、story、gallery、photos 视「纪念册是否并入纪念 tab」而定。rsvp、guestbook 改为只读归档，不移除。
- 服务：event-program、music、venue-location；rsvp、guestbook 只保留读取部分，去掉保存和 mock 写入。
- 云函数：event-program.js；core.js、guestbook.js 只保留读取（改为成员校验）；`COLLECTION_CLOSES_AT` 不再需要，`ADMIN_OPENIDS` 由 household 成员替代。
- 对应测试和 `test-ui.mjs` 中的婚宴用例；`artifacts/` 下的临时文件。

## 7. 与 v2 方案的冲突点（需要你决定）

1. **语言**：方案写「原生 WXML / WXSS / JS」，项目是 **TypeScript**（开发者工具编译插件，零配置）。建议保留 TS。
2. **云函数名**：方案要 `api` 和 `ai-suggest`，现有是 `weddingApi`。建议新建 `api`，旧函数在阶段 1 后不再部署。
3. **鉴权模型**：现有用环境变量 `ADMIN_OPENIDS` 白名单；方案用 `households.members`（邀请码绑定）。两者不兼容，`api` 改为每次按 openid 查 household。
4. **记录字段**：现有记录用 `updatedAt`（ISO 字符串）、文档 ID = sha256(openid)；方案要求 `householdId`、`ts`、`by`。新集合按方案，不沿用旧结构。
5. **时区**：现有日期逻辑全部按 **UTC+8**（中国）；你在日本，纪念日、按月统计的「今天」「本月」应按 **UTC+9**。需确认用哪个。
6. **现有集合**：`photo_content`、`event_program` 是「draft / published 两个单文档」结构，`rsvps`、`guest_messages` 以 sha256(openid) 为文档 ID，都不带 householdId。建议旧集合保持原样只读，新功能用新集合；归档页由 `api` 校验成员身份后读取旧集合。
7. **导航**：现有没有 tabBar；方案要 5 个 tab（记账、清单、吃啥、周末、纪念）。未绑定小家时的入口页放在哪里（tabBar 外的单独页面）需要确认。
8. **分享**：现有页面都有 `onShareAppMessage`（对亲友公开转发）；体验版只给两人用，建议去掉分享。
9. **隐私与平台**：ICP 已备案，但主体类型（个人/企业）未确认；隐私保护指引、名称、类目需随功能改写。
10. **数据备份**：这次差点丢数据。建议你先在 CloudBase 控制台导出 `rsvps`、`guest_messages`、`photo_content`、`event_program`，并下载云存储 `wedding/` 目录，存到本地（不提交到 git）。这一步需要登录后台，由你操作。
11. **续费周期**：确认新购套餐的到期日，设个提醒，避免再次过期。

## 8. 已确认的决定（2026-10-20）

- 保留 TypeScript。
- 日期按中国时区 UTC+8 计算。
- 不做 mock，直接用云环境测试。
- 照片不保留；答谢宴页面全部重构。
- 登记与祝福保留为一个只读归档页（「纪念」→「答谢宴 · 登记与祝福」），由 `api` 校验成员后实时读取旧集合 `rsvps`、`guest_messages`。
