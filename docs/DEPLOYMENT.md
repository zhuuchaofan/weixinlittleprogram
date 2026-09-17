# CloudBase 接入与安全边界

项目支持 mock 和 CloudBase。登记已有云端接入；本次照片管理代码尚需主人更新云函数并新建 photo_content 集合，具体见 [照片管理指南](PHOTO-MANAGEMENT.md)。未代为操作线上环境。

## 配置与架构

`local.ts` 由 `local.example.ts` 创建，并被 Git 忽略。`project.config.json`（已有 AppID）与 `project.private.config.json` 同样被忽略；仓库使用 `project.example.json` 提供无真实账号信息的模板。

```text
页面 → services/rsvp.ts → mock-rsvp（本机 wx storage）
                       → cloud.callFunction(weddingApi)
                          → 服务端 getWXContext().OPENID
                          → 参数校验 / 管理员白名单
                          → rsvps 集合
```

为避免复制鉴权代码，本版把规划中的多个云函数合并为一个 `weddingApi`，以 action 区分，不改变信任边界。

| action                                               | 允许的操作                                 |
| ---------------------------------------------------- | ------------------------------------------ |
| `getMine`                                            | 按当前真实 OpenID 读取本人记录             |
| `save`                                               | 按当前真实 OpenID 更新或新建本人登记       |
| `removeMine`                                         | 删除本人记录，不接受任意目标 ID            |
| `dashboard`                                          | 验证管理员白名单后获取汇总与每页 50 条明细 |
| `getAccess`                                          | 返回当前账号是否为管理员，不暴露管理员名单 |
| `getPhotos`                                          | 只读取已发布照片安排                       |
| `getPhotoDraft` / `savePhotoDraft` / `publishPhotos` | 仅管理员读取、保存或发布照片草稿           |
| `uploadPhoto`                                        | 仅管理员上传压缩后的 JPG 或 PNG            |
| `inspectManagedPhotoFile`                            | 仅管理员检查 managed 照片的草稿/已发布引用 |
| `deleteManagedPhotoFile`                             | 仅管理员永久删除无引用的 managed 照片      |

所有云函数返回 `{ok,data}` 或 `{ok:false,code,message}`。客户端不会在云端失败时降级成本地成功；提交按钮期间锁定，失败保留表单。重试依然写同一记录。

## 数据库

创建 `rsvps` 集合。在控制台的**自定义安全规则**中使用 `cloudfunctions/database.rules.json`：

```json
{ "read": false, "write": false }
```

此文件不会自动部署规则，必须在实际环境设置。客户端不直接访问数据库；服务端 SDK 仍可访问，所以云函数鉴权同样不可省略。

记录字段：`guestName`（1–30 字）、`attending`（boolean）、`partySize`（到场 1–10，未到场 0）、`note`（至多 200 字）、`consent`、`openid`（只在后台）、`updatedAt`（服务端 UTC ISO 字符串）。`_id` 是服务端对当前 OpenID 的 SHA-256，不接收访客提供的目标 ID。并发重复提交使用同一文档 ID；最多一条，最后成功写入的内容生效。

`dashboard` 查询按 `_id` 排序分页，基础 `_id` 索引用于游标；`attending` 用于汇总，如控制台提示索引缺失，为该字段建立升序索引后再测。汇总在服务端进行，不仅统计当前 50 条。汇总与列表是独立查询，高并发更新瞬间可能有短暂差异，刷新后复核。

## 函数部署

1. 选择环境，部署 `cloudfunctions/weddingApi` 并云端安装 `wx-server-sdk` 依赖。
2. 服务端 Node.js 运行时选平台当前支持的版本（支持 `node:crypto`）；不需要前端 npm 构建。
3. 服务端环境变量 `ADMIN_OPENIDS` 保存管理员 OpenID，逗号分隔，空值时拒绝所有管理员请求。获取本人 OpenID 的操作见 NEXT-FOR-OWNER。
4. 不配置公网 HTTP 触发器、不加入支付或额外密钥。
5. 前端 `mode: 'cloud'`、正确的 `cloudEnvId`，重新编译。所有 mock 提示应切换为云模式语义。
6. 按自测清单进行两账号隔离、重试、删除、分页测试。完成前不要将预览发给真实宾客收集登记。

## 云存储

照片可由主人通过控制台上传，或从新增的照片管理页面经管理员云函数上传；普通访客不能上传。云存储设置为访客可读展示图、客户端不可写；使用自定义规则时同样注意后端 SDK 的权限边界。保存原始高质量素材在主人受控空间，小程序仅放经同意展示的衍生图。公开可读的图片不具备防转发能力。

配置云图后，前端在 cloud 模式初始化环境；图片失败仍有占位重试。临时链接、缩略图加载和原生预览必须真机核验，未将浏览器模板预览算作云图测试。

## 运营与删除

- 不在日志中记录请求体、姓名、备注、OpenID。后端异常只向前端返回通用错误。
- 保留期限目前是建议说明，不是自动清理任务。主人确认期限、到期清理数据库；如开启备份，也自行同步备份保留策略。
- 访客可从隐私页删除自己的登记。禁止管理员名单混入 `site_config` 或任何公开内容数据。
- 不将本机 mock 数据导入生产；本机数据通过隐私页删除，或清除测试缓存。

## 官方资料与验证范围

实现参考微信官方示例仓库的 [项目配置](https://github.com/wechat-miniprogram/miniprogram-demo/blob/master/project.config.json) 与 CloudBase 官方维护的 [小程序工程指引](https://github.com/TencentCloudBase/awesome-miniprogram-skills/blob/main/SKILL-DEV-GUIDE.md)。可通过 [微信开发文档](https://developers.weixin.qq.com/miniprogram/dev/framework/) 和 [CloudBase 文档](https://docs.cloudbase.net/) 核对当前平台说明。

本次微信文档部分页面无法被研究工具直接抓取，因此不声称核验了当前备案/认证/收费规则；账号、费用和发布事项以主人控制台当日显示为准。

## 隐私整改版本部署顺序

1. 填写 `content.ts` 中的真实微信号联系渠道，执行本地检查。
2. 确认 `rsvps`、`photo_content` 禁止客户端读写；存储禁止客户端写入。
3. 部署新版 `weddingApi` 并保留 `ADMIN_OPENIDS`。新增的 `inspectManagedPhotoFile`、`deleteManagedPhotoFile` 均只允许真实管理员调用。
4. 上传体验版后，在公众平台配置用户隐私保护指引及体验版指引，再用管理员真机测试选图授权。
5. 完整的双账号、真机和提审资料清单见 [REVIEW-READINESS.md](REVIEW-READINESS.md)。

新版本不会自动变更线上数据库规则、存储规则、环境变量、公众平台隐私指引、备案、认证或审核状态。

## 答谢宴现场版：私密祝福部署（2026-09-17）

新版 weddingApi 新增一组独立 action；前端仍只调用云函数，不能直接读写数据库。

| action              | 允许的操作                                              |
| ------------------- | ------------------------------------------------------- |
| guestbookGetMine    | 按当前真实 OpenID 读取本人的一条祝福                    |
| guestbookSave       | 保存或更新当前真实 OpenID 的一条祝福                    |
| guestbookRemoveMine | 删除当前真实 OpenID 的祝福                              |
| guestbookDashboard  | 仅通过 ADMIN_OPENIDS 白名单读取汇总和每页 50 条私密祝福 |

### 需要由主人完成的线上操作

1. 在云开发数据库新建 **guest_messages** 集合，并在“权限设置 / 自定义安全规则”填入：

   { "read": false, "write": false }

   rsvps、photo_content 也保持同样的客户端禁读写规则。此规则不妨碍云函数服务端 SDK，但不能代替云函数的管理员鉴权。

2. 部署最新 cloudfunctions/weddingApi，选择“云端安装依赖”，**保留**已有 ADMIN_OPENIDS 环境变量。不要把管理员 OpenID 放进前端配置、数据库公开字段或截图。
3. 编译体验版，用管理员微信打开“主人工作台”，确认登记汇总、照片管理和“私密祝福”都可见；用访客微信确认工作台和 guestbookDashboard 被拒绝。
4. 用访客微信写、修改、删除祝福：同一账号始终只有一条；另一个账号不能读取、修改或删除它。
5. 现场二维码填写 pages/home/index?scene=banquet，扫码后确认主按钮进入照片册。

云端记录字段：signature（0–30 字）、message（1–120 字）、consent、updatedAt 与仅服务端保存的 openid。_id 由服务端对 OpenID 做 SHA-256 得到；云函数响应和页面不返回 OpenID。
