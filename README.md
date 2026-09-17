# 两猫一屋

两个人、球球、布丁，和许多好日子的原生微信纪念册。

**首版 mock 已实现，可直接导入微信开发者工具。** 没有云环境也能浏览全部页面、填写和修改本机登记、查看本机管理员演示。真实 CloudBase 连接、双账号和真机验收尚未执行。

## 打开项目

1. 在微信开发者工具中打开本目录 `D:\chaofan\weixinlittleprogram`，不是其中的 `miniprogram` 子目录。
2. 当前已有的 `project.config.json` / `project.private.config.json` 已保留；只补充源码目录、云函数目录和 TypeScript 编译插件。已有 AppID 未改写。
3. 点「编译」，入口为 `pages/home/index`。本项目不需要「构建 npm」：前端无运行时 npm 依赖。
4. 如果从干净副本开始，先在终端运行：

```powershell
npm ci
npm run setup
```

`setup` 仅创建缺失的本地配置，不覆盖已有值。默认使用 `touristappid` 占位；有自己的 AppID 时，仅在本地开发者工具填写。游客模式的分享、云开发和真机能力受限，以工具提示为准。

## 已实现

- 首页：照片纸边、电影章节式目录、两猫署名和彩蛋、默认减少动效。
- 电子请柬：集中配置的日期、场地、署名、温馨提示；已确认坐标才允许地图导航；可复制地址。
- 故事：配置驱动的时间线与多张照片。
- 相册：相识 / 旅行 / 婚礼分组，双列错落排版，原生 `wx.previewImage` 大图左右切换。
- 登记：称呼、是否到场、总人数（含本人 1–10 人）、备注、隐私同意；读回、更新、删除、失败重试。
- 管理页：总回复、到场人数和明细；mock 只显示本机，cloud 由后端白名单鉴权，分页读取。
- 隐私：最小采集、删除自己的登记、保存期限与联系方式说明。
- 图片：明显标注的占位资源；失败状态和重试；真实照片默认完整显示，不自动裁人脸。

所有示例信息均可替换。`2026.09.27` 与新人姓名取自原需求草案，日期仍标为待主人确认；没有编造酒店、经纬度、父母姓名或真实故事。

## 改内容和继续接云端

- [内容替换指南](docs/CONTENT-GUIDE.md)
- [主人下一步操作](docs/NEXT-FOR-OWNER.md)
- [CloudBase 部署与安全边界](docs/DEPLOYMENT.md)
- [自测清单与本次证据](docs/TEST-CASES.md)
- [视觉与实现说明](docs/DESIGN.md)

## 验证命令

```powershell
npm run check          # TypeScript + ESLint + 数据/权限测试
npm run format:check   # TS / JS / JSON / Markdown 等格式
npm run check:native   # 使用本机微信工具附带 WXML/WXSS 编译器
npm run preview        # 127.0.0.1:4173，本地模板适配预览
# 保持上面的服务运行，在另一终端：
npm run test:ui        # Edge / Playwright 多尺寸与交互测试
```

浏览器辅助预览直接读取实际 WXML、WXSS 和页面 TypeScript，**不是微信基础库**，不替代开发者工具或真机。它只监听本机，不包含在小程序包内。默认 Edge 路径、微信编译器路径可用 `BROWSER_PATH`、`WECHAT_COMPILER_DIR` 环境变量覆盖。WXML/WXSS 使用原生编译器验证；Prettier 不改写它们。

本次通过：TypeScript、ESLint、数据/权限测试、原生模板/样式编译以及 320 / 360 / 393 / 430 / 1280px 模板布局检查。证据和待验项见自测文档。开发者工具自动化 CLI 因本机配置目录缺失未能连接，未声称已完成原生模拟器逐页截图。

## 文件结构

```text
miniprogram/
  app.ts / app.json / app.wxss
  config/content.ts       婚宴、故事、照片、品牌
  config/ui-copy.ts       所有页面文案、隐私正文、提示语
  config/local.ts         本地模式和环境 ID，不进版本库
  services/              内容入口、RSVP 接口、mock/cloud 实现
  components/            图片框、页脚
  pages/                 七个原生页面
  assets/                三张明确标注的 PNG 占位图
cloudfunctions/
  weddingApi/            save/getMine/removeMine/dashboard 云函数
  database.rules.json    rsvps 客户端禁止读写的规则模板
docs/                    交接与自测
scripts/                 本地检查与辅助预览，不会打包至小程序
tests/                   数据与权限回归
```

## 边界

不索取或使用 AppSecret、微信密码、身份证、支付信息；不操作公众平台，不执行备案、认证、审核或发布。没有支付、广告、公开宾客名单和公开祝福墙。数据库客户端全部禁止读写，由云函数验证实际 OpenID。管理员名单只放服务端环境变量；不能放入公开内容配置。云端失败不会回退成本地保存。

mock 是本机交互演示，不能用来收集真实宾客回复。切换云端不会迁移 mock 数据。照片展示不是访问控制；上线前只放已获得展示同意的素材。

## 主人照片管理（2026-09-17）

已添加仅管理员可见的主人入口、手机上传、用途/说明/顺序调整、保存草稿和更新展示。部署配置与验收请见 [照片管理指南](docs/PHOTO-MANAGEMENT.md)。新建 photo_content 并更新 weddingApi 后再真机验证。
