# 代码架构整理报告（2026-09-22）

## 1. 现状与主要问题

本项目使用原生微信小程序 TypeScript，入口为 app.ts（没有独立 app.js 源文件）。app.json 注册 10 个页面、6 个全局组件。没有 tabBar/custom-tab-bar、behaviors、独立 api/helpers/assets 目录；图片主要来自内容配置和云存储。没有新增运行时依赖的必要。

现有分层已基本合理：页面负责交互和 setData，services 负责业务数据、媒体及微信能力访问，utils 放导航、日期、校验等工具，config 放内容与文案，models.ts 定义数据形状。云函数 weddingApi 由入口分派到登记、祝福、照片和流程模块，客户端数据库权限默认关闭。

主要维护负担是照片管理页同时处理选择结果、上传队列、编辑、保存发布和文件清理；首页、隐私页、音乐组件重复解释动效存储值；工作台两种记录的日期转换完全重复。首页、相册、故事刷新逻辑相似，但回退内容、竞态版本和展示映射不同，暂不统一。

## 2. 实际修改

- 把照片管理页选择结果的顺序读取、视频信息回退、逐项校验与失败收集移到 services/media-selection.ts。页面仍负责隐私授权、chooseMedia、生命周期检查、待上传状态和提示。保留原有数量裁剪、ID 生成、文件顺序、错误文案以及 iOS 选择元数据优先规则。
- 新增 services/motion-preference.ts，将 3 个使用方的 4 处读取及 1 处写入统一；保留 two-cats:motion、on/off 含义、异常传播和读取时机，不加缓存或默认写入。
- 在 utils/date.ts 提取 formatRecordDates，合并工作台登记与祝福的重复展示转换；保留记录字段、数组顺序、本地时区和无效日期原样返回，不修改服务对象。
- 补充媒体元数据与离页边界测试；修正辅助 UI 测试过时的按钮定位表达式，不改产品文案。
- 同步 README 的实际页面数量及架构文档入口。

## 3. 整理后的目录（保留原有布局）

```text
miniprogram/
  app.ts / app.json / app.wxss / models.ts
  pages/          home invitation story gallery rsvp guestbook admin privacy program photos
  components/     photo-frame media-video page-footer music-control page-back-link editor-action-bar
  services/       原有 cloud、access、photos、media-upload、photo-upload、rsvp 等
    media-selection.ts     新增：选择结果准备
    motion-preference.ts   新增：动效偏好读写
  utils/
    date.ts                新增 formatRecordDates，原导出不变
    navigation.ts / editor-navigation.ts / 其他原有工具
  config/         原内容、文案、本地环境和音乐配置
cloudfunctions/   weddingApi 及 database.rules.json，未修改
scripts/          原检查与预览脚本，仅修正 UI 测试定位
 tests/           原测试，media.test.cjs 增加两个边界用例
 docs/            原文档及本报告
```

## 4. 公共组件与样式

本次没有新增组件。返回主人工作台已经共用 page-back-link 的外观与位置、leaveEditor 的离页保护以及 returnTo 的返回/直达回退。照片和流程页保留各自 busy/loading、dirty 和提示内容，避免强行统一导致交互变化。

继续复用 photo-frame、media-video、page-footer、music-control、editor-action-bar。WXML、WXSS、组件属性和 triggerEvent 均未改动。公共按钮、卡片、空态已有 app.wxss 基础规则；剩余样式合并收益不足以抵消级联与组件样式隔离风险，本次保留。

## 5. 公共方法与重复代码合并

| 方法                              | 调用位置             | 职责                                              |
| --------------------------------- | -------------------- | ------------------------------------------------- |
| prepareSelectedMedia              | 照片管理 add         | 返回 chosen/failures；不上传、不保存、不操作 Page |
| getReduceMotion / setReduceMotion | 首页、隐私、音乐组件 | 唯一动效偏好存储解释                              |
| formatRecordDates                 | 工作台两类列表及分页 | 同一日期展示转换                                  |

不为 Toast/Modal 的几行参数额外引入通用封装；各处文案、禁用条件、异常处理不同。页面没有需要搬迁的大量直接数据库调用；已有 callCloud 统一 weddingApi 请求和返回解析，继续保留。

## 6. 刻意保持不变的兼容边界

- 全部页面 path、入口、分享 title/path、dataset、事件名、生命周期和组件注册。
- 数据库集合、字段、云函数名称/action、payload/返回结构、鉴权与管理员缓存。
- 草稿与发布分离、截止时间规则、本人数据删除、旧媒体字段兼容和空发布列表语义。
- 图片压缩参数与请求限制、视频上传票据/校验/进度/取消、失败后重试、恢复 storage key。
- photo-url 兼容包装、旧 Photo/imageUrl/字符串归一化、照片 A/B 预加载与缓存失效逻辑。
- 首页/相册/故事刷新版本控制、音乐前后台生命周期；不合并差异化页面状态机。
- local.ts、项目私有配置及云端部署均未改动；没有删除不明用途代码。

## 7. 验证结果与范围

- 修改前：npm run check 通过（43 项测试），原生 WXML/WXSS 编译通过。
- 修改后：TypeScript、ESLint、45 项自动测试通过；新增用例覆盖 iOS 视频元数据优先、读取失败回退、单项失败隔离、数量裁剪、顺序和读取期间离页。
- npm run check:native：16 个 WXML、17 个 WXSS 编译通过。
- 静态扫描：10 个页面、6 个组件文件齐全；103 个 WXML 事件绑定和 14 个固定 navigator 目标有效。TypeScript 检查覆盖模块路径和调用类型。
- npm run test:ui：73 项通过，包含 10 页面 × 5 尺寸布局，以及首页、相册预览、图片失败回退、工作台、登记/祝福读写、隐私删除、媒体选择队列、编辑未保存保护和草稿发布。
- UI 测试首次末项因旧选择器“添加照片 一次最多”找不到当前“添加照片 / 最多 9 张”按钮超时；改为匹配“添加照片”后完整重跑通过。产品按钮未改动。
- 辅助结果在 artifacts/ui/results.json，截图在 artifacts/ui/；该目录原本被 Git 忽略。

启动路径与模板已编译、mock 页面可进入；这不等同于微信基础库及真实 CloudBase 运行。上传/云调用自动测试使用模拟微信接口，未实际写入或删除云端数据。视频封面与组件注册已检查，但真机实际解码、分享转发、微信授权和云存储链路仍需人工验收。未宣称已证明所有环境下 100% 行为一致。

## 8. 发现但保留的潜在问题

- home.onShow 无条件 refreshProgram，且当天又调用一次；现有版本号会淘汰旧响应，但可能产生额外请求。保持原行为，后续单独确认请求合并是否合适。
- 流程页和照片页的发布确认与忙碌态保护时机存在差异。没有合并 persist 或修改防重复点击策略。
- 照片页仍较长，上传队列、草稿状态和离页恢复紧密关联；继续拆为行为混入会提高隐式 this/setData 耦合，暂不进行。

## 9. 人工回归重点

1. 微信开发者工具编译、首页及全部 10 页进入；普通返回、分享直达、返回主人工作台；确认保留“返回上一页，失败或直达再回退”的原语义。
2. iPhone/Android 分别选择 1 张及多张图片、选择视频、取消权限、退出选取；上传中切后台/返回，再进入恢复与失败重试。
3. 视频封面与播放/停止、切换媒体、前后台暂停；原图预览、缓存回退和慢网图片切换。
4. 草稿保存、发布、File ID 导入、只移除展示与安全清理的原流程；真实云端需使用受控测试数据核验。
5. 普通/主人两账号核验登记、祝福、工作台权限与读取隔离；Loading/Toast/Modal、隐私开关和分享入口。

## 10. 需要人工确认

本次架构整理没有待决定的业务变更，也没有执行部署、提交或推送。上述真机与云端验收、潜在重复刷新是否另开修复是后续人工确认项。
