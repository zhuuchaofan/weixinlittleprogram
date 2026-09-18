# 主人下一步

## 现在上线前

1. 在 `miniprogram/config/local.ts` 填写正确 CloudBase 环境 ID；在 `content.ts` 核对姓名、日期、地点、地图坐标和隐私微信号。
2. 创建 `rsvps`、`guest_messages`、`photo_content` 三个集合，并将每个集合规则设为 `{ "read": false, "write": false }`。
3. 部署新版 `weddingApi`，保留 `ADMIN_OPENIDS` 并新增：

```text
COLLECTION_CLOSES_AT=2026-09-28T16:00:00.000Z
```

4. 用管理员账号进入“主人工作台 → 照片管理”，用普通账号确认看不到管理员入口，也不能读取草稿、统计或私密祝福。
5. 用普通账号测试登记与祝福各一次，再删除自己的测试内容。不要导出宾客数据。
6. 通过公众平台按实际功能配置隐私保护指引、备案、认证和类目；这些状态仅以平台实时结果为准。

## 照片

- 管理页上传的照片在 `wedding/managed/`；只有解除所有草稿与已发布引用后，才可在管理页永久删除。
- `wedding/original/` 等手动维护原图不在安全删除范围，按控制台流程管理。
- 当前所有照片列表自动生成最大边长 1080px 缩略图，大图仍是原图；无需重新上传已有婚纱照。
- 真机检查横竖图、预览返回、弱网重试和更新照片时旧图不闪回占位。

## 音乐

当前音乐已关闭，现有歌曲 File ID 已清空。只有替换为自有或已获公开播放授权的 MP3 后，才在 `miniprogram/config/music.ts` 填入 File ID 并改 `enabled: true`。启用后，分别在 iPhone 与安卓验证静音开关、与其他音频混音、前后台暂停恢复和手动暂停偏好。

## 时间线

- **2026 年 9 月 29 日起**：首页与请柬隐藏收集入口；云函数拒绝新增或修改登记、祝福。本人删除与主人读取保留。
- **2026 年 12 月 27 日前**：确认无需保留后，在 CloudBase 删除 `rsvps` 和 `guest_messages` 数据，不导出名单或祝福。
- **清理后**：按 `DEPLOYMENT.md` 发布纯照片纪念册版本，移除登记、祝福、统计和 mock，保留管理员照片管理。

## 每次上传前

运行：

```powershell
npm run check
npm run check:native
npm run preview
# 另一终端
npm run test:ui
```

再在开发者工具实际编译，并用 iPhone、安卓、管理员和访客双账号完成 [自测清单](TEST-CASES.md)。
