# 球球布丁家属院

朱超凡&高佳益的微信答谢宴纪念册。它向亲友提供电子请柬、照片册、故事、到场登记和仅主人可见的文字祝福；照片由主人在后台管理，数据通过 CloudBase 云函数处理。

当前共有 10 个页面：首页、电子请柬、故事、照片册、到场登记、私密祝福、主人工作台、照片管理、当天流程、隐私说明。没有支付、广告、公开宾客名单或公开祝福墙。

## 当前状态

- 照片与音乐均使用 CloudBase File ID，不放进小程序代码包。
- 新照片与视频封面原文件直传，不再 Base64 上传或逐档压小；列表使用 1080px WebP 缩略图，失败可回退，点击看原文件。部署顺序见 [图片链路](docs/IMAGE-PIPELINE.md)。
- 照片册已在本地实现照片／视频总览、四类照片和私密展示开关；需先部署新版云函数再上传小程序，详见 [分类与私密说明](docs/MEDIA-CATEGORIES-PRIVACY-PLAN.md)。
- 管理员入口只作为界面展示缓存 5 分钟；云函数每次管理操作均按真实 OpenID 鉴权。
- 背景音乐当前**关闭**，`miniprogram/config/music.ts` 没有 File ID。仅可在替换为自有或已获公开播放授权的音频后启用。
- 2026 年 9 月 29 日起停止新增或修改登记、祝福；本人仍可删除，主人仍可读取和清理至 2026 年 12 月 27 日。

真实 CloudBase 规则、云函数部署、双账号隔离和 iPhone/安卓验收仍需在你的环境完成，不能由本地代码证明。

## 使用

1. 在微信开发者工具打开 `D:\chaofan\weixinlittleprogram`，不要只打开 `miniprogram` 子目录。
2. 保留本地的 `project.config.json` 与 `project.private.config.json`，在 `miniprogram/config/local.ts` 配置环境 ID。
3. 如为干净副本，运行：

```powershell
npm ci
npm run setup
```

4. 编译入口为 `pages/home/index`。前端没有运行时 npm 依赖，无需“构建 npm”。

## 常用命令

```powershell
npm run check          # TypeScript、ESLint、自动测试
npm run format:check   # 格式检查
npm run check:native   # 本机微信 WXML/WXSS 编译器检查
npm run preview        # 本地辅助预览，仅监听 127.0.0.1
npm run test:ui        # 在 preview 运行时执行多尺寸辅助回归
```

浏览器辅助预览直接读取项目 WXML/WXSS/TS，但不是微信基础库，也不能替代开发者工具和真机验收。

## 文档

- [代码架构整理与回归报告](docs/ARCHITECTURE-REFACTOR.md)

- [内容维护](docs/CONTENT-GUIDE.md)
- [CloudBase 部署与收束](docs/DEPLOYMENT.md)
- [主人待办](docs/NEXT-FOR-OWNER.md)
- [自测与真实验收](docs/TEST-CASES.md)
- [照片管理](docs/PHOTO-MANAGEMENT.md)
- [提审前核验](docs/REVIEW-READINESS.md)

## 边界

数据库集合禁止客户端直接读写；管理员白名单仅保存在云函数 `ADMIN_OPENIDS`，不得放入前端。访客数据不导出；照片展示前须取得当事人同意。不要在内容配置、云存储文件名、祝福或备注中写入密码、OpenID、身份证、支付信息、手机号或健康信息。

媒体上传支持图片多选和相册视频；部署及兼容说明见 [媒体上传](docs/MEDIA-UPLOAD.md)。保持保存草稿与更新展示分离。
