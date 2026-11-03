# 配方工作室

本地配方梳理工具，使用占位 Item，可自建物品及绑定 PNG 图标。

## 启动

双击 `启动.command`，或在本目录执行 `python3 server.py`，浏览器访问 http://127.0.0.1:8766/ 。需要 Python 3；关闭服务终端即停止服务。

## 操作

任意位置单击 Item（目录、最近栏、工作区或配方预览），右上显示物品属性，右下显示其配方；点击底图、空槽位或空白后返回对应对象属性。

- 左上 Item 目录：展开分类、搜索、点击查配方、拖入槽位。右键目录新建 Item 或子目录，分类以 `/` 分层；右键 Item 绑定图标。动态贴图可同时选择 PNG 与同名 `.png.mcmeta`，也可先绑定 PNG 后单独选择 `.mcmeta`；支持 `frametime`、`frames` 中的帧顺序和单帧时长、`interpolate` 插值。竖向正方形 PNG 帧图未附配置时默认顺序播放。图标与动画配置会随工程保存，并在各处及拖动时播放。目录树下方一行显示最近成功拖入槽位的 Item，可直接拖取；重复使用移到最前，最多保留 20 项，并随工程保存。
- 左下文件与素材：用可展开目录树浏览文件，右键导入本机文件夹或图片，文件可拖入工作区。模板与已存配方位于独立的“合成面板模板”面板。
- 工作区：左键拖空白平移，滚轮缩放，右键拖动框选：从左往右为蓝色实线完整包含，从右往左为绿色虚线相交选择；组合配方按整体边界判断。左键拖选中底图整体移动。Item 拿取时图标与数量跟随鼠标：从库里拖出为复制，从槽位拿出为移动；放入已有物品的槽位会交换，取消或放到工作区外则还原。Item 也可独立放在工作区，再拖入槽位。Shift 点击可增减选择。
- 自定义模板：拖入底图，开启“放置槽点”后点击底图加槽；关闭后可拖动对齐或通过属性精确定位。单独选中图像后可拖动右下角控制点缩放，或输入宽高；默认保持比例，可在属性中关闭。右键拖动框选对象，再右键“组合为模板／组合为配方”；普通选中不显示组合操作。组合为配方时必须有放入 Item 的输出槽位；检测到未归位 Item 会提醒返回调整，或确认继续将其保留为展示对象。
- 配方：设置投入与产出槽并填入 Item，右键产出 Item 保存配方；点击 Item 在右下查看配方，产出显示于标题旁，可把整张配方作为整体加入工作区，拖动底图移动整组，右键底图“解耦该配方”后可单独移动内部对象；右键槽位切换输入／输出，只显示另一种状态。同一 Item 的多条配方通过“前一个／下一个”切换；“删除该配方”弹窗确认后只删除当前配方，不删除 Item、模板或工作区对象。
- 保存：使用“保存工程”导出 JSON；“打开工程”恢复。工程包含自建 Item、分类、图标、底图、工作区、模板及配方。本机服务会自动保存到 `.local/project.json`，下次启动恢复；JSON 导出可作为独立工程文件保存。旧版本的工程 JSON 可以继续导入。

本工具不修改 Minecraft 文件，也不直接注册游戏物品或导出模组配方。

## 本地 API / AI 接入

服务只监听 `127.0.0.1:8766`。页面和 API 使用同一份工程，修改约一秒内同步；编辑输入框、拖动或打开弹窗时暂缓接收外部更新。两边同时修改会提示选择 API 版本或当前页面，旧 revision 的写入返回 `409`，不会覆盖已有修改。

- `GET /api/schema`：AI 首先读取的接口和数据结构说明。
- `GET /api/summary`：工程摘要、Item ID 与名称、配方和模板索引，不包含图片数据。
- `GET /api/project`：完整 `{revision, project}`。
- `PUT /api/project`：提交 `{revision, project}`，整体替换工程。
- `GET /api/items`、`/api/objects`、`/api/recipes`、`/api/templates`、`/api/categories`、`/api/files`：分别读取资源。
- `POST /api/<资源>`：提交 `{revision, value}` 新建；新 Item 可同时传 `category: ["加工材料", "压缩板"]`。
- `PATCH /api/<资源>/<键>`：提交 `{revision, changes}` 修改单条。
- `DELETE /api/<资源>/<键>`：提交 `{revision}` 删除单条。

Item 与工作区对象以字符串 ID 为键；配方、模板、分类和文件以零起始索引为键。修改前先读取最新 revision。服务会检查 Item 引用、坐标尺寸、数量和配方有效输出，不接受引用断裂或缺少输出的配方。未归位 Item 会列入响应 warnings。

例如，让 AI 将某个 Item 改名：先读取摘要找到 ID，再读取当前工程 revision，然后发送：

```http
PATCH /api/items/plate-a
Content-Type: application/json

{"revision": 3, "changes": {"name": "强化面板"}}
```

其中 `3` 需替换为刚读取的 revision。图片与图标使用 `data:image/...` 内嵌数据。动态 Item 另外设置 `iconAnimation`，内容为 `.png.mcmeta` 的 JSON（例如 `{"animation":{"frametime":3,"interpolate":true}}`）；将其设为 `null` 可恢复静态显示。`server.py --port 8767 --state .local/another-project.json` 可启动独立工程用于检查，不影响默认工程。

## 验证

```sh
python3 -m unittest discover -s tests -v
node tests/test_editor.js
node tests/test_icon_animation.js
```
