# petdex-overlay

> 给 AI 编码 Agent 配一只会开盲盒的桌面搭子。

Windows 桌面悬浮宠物。它监听 **Codex** / **Cursor** / **Kimi Code** 的 hook：Agent 思考时跳一下，调工具时来回跑，一轮结束入库一个密封盲盒。双击宠物开箱，攒仓库、点图鉴、吃保底。

兼容 [petdex](https://petdex.dev) 的精灵图格式（本仓库是独立客户端，非 petdex 官方项目）。纯本地运行，不联网、不上传代码或对话。

**快速开始**：`git clone https://github.com/WU55UY/petdex-overlay.git` → `powershell -ExecutionPolicy Bypass -File .\install.ps1` · [完整安装说明](#安装) · 纯本地运行，不联网、不上传代码或对话。

## Codex 用户先看这里

Codex 里的宠物，和这个仓库的悬浮窗，是两件事。

1. **Codex 自带宠物**走官方 Petdex，不用 clone 本仓库。`npx petdex install <slug>` 会装进 `~/.codex/pets/<slug>/`，然后在 Codex 的 **Settings → Appearance → Pets** 里选中。疾风的 slug 是 `jifeng-q`，画廊还在审核，公开执行 `npx petdex install jifeng-q` 现在装不到。审核通过之后，Codex 用这一行就够了，不需要下 GitHub。
2. **本仓库**是 Windows 上的悬浮窗和盲盒，另外听 Codex、Cursor、Kimi Code 的 hook。仓库里自带的示例宠物是 Byte，不是疾风。疾风的精灵图在画廊，不放进这个 MIT 仓库，所以 clone 下来不会让 Codex 里出现疾风。

悬浮窗要跟着 Codex 动：

```powershell
git clone https://github.com/WU55UY/petdex-overlay.git
cd petdex-overlay
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Agents codex
```

装完打开 Codex，在 `/hooks` 里信任这次新增的 hook，否则 Codex 不会跑它们。手里已经有疾风的文件夹时，不用等画廊：复制到 `%USERPROFILE%\.codex\pets\jifeng-q\` 就能在 Codex 里选；悬浮窗再用：

```powershell
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" add "$env:USERPROFILE\.codex\pets\jifeng-q"
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" select jifeng-q
```

审核通过后，上面的文件夹也可以改成官方安装得到的那一份：`npx petdex install jifeng-q`。

<p>
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-green">
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D18-339933">
  <img alt="Python" src="https://img.shields.io/badge/python-3.10%2B-3776AB">
</p>

[English README](README.en.md)

---

## 它是什么

```
Codex / Cursor / Kimi Code
      │  hook events (prompt / tool / stop)
      ▼
  bridge.mjs  ──►  %USERPROFILE%\.petdex\runtime\*.json
      │                         │
      │                         ▼
      └──►  loot.mjs       Python + Win32 悬浮层
             （盲盒/仓库/图鉴）      （逐像素透明、置顶、可拖动）
```

- **状态联动**：提问 → 跳；PreToolUse → 跑；PostToolUse → 停；Notification → 等待；Stop → 挥手并入库。
- **盲盒**：每轮结束按本轮工具调用数入库一个密封箱（手提箱 / 小保险箱 / 保险柜）。双击开一个，不自动开。
- **仓库与图鉴**：白/绿/蓝/紫/金/红六档，115 件红品图鉴；有软保底、60 箱硬保底、连续重复红保底。
- **多窗口**：按 `conversation_id` / `session_id` 分别计数，多个 IDE 窗口共享一只宠物；只要还有工具在跑就保持忙碌。
- **托盘面板**：单击循环「仓库 → 图鉴 → 阅读 → 关闭」，滚轮翻页；右键关闭，拖动移动。
- **petdex 兼容**：8 列 × 9 行、192×208 的精灵图；可直接导入 petdex 画廊里的宠物。
- **本地优先**：所有状态在 `%USERPROFILE%\.petdex\`，无网络请求。

## 环境要求

| 依赖 | 说明 |
|------|------|
| Windows 10 / 11 | 悬浮层使用 Win32 分层窗口 |
| Node.js 18+ | hook 桥接、CLI、盲盒引擎 |
| Python 3.10+ | 悬浮层渲染 |
| Pillow + pywin32 | `python -m pip install pillow pywin32` |
| Codex、Cursor 和/或 Kimi Code | 需要支持 hooks 的版本。Codex 还要在 `/hooks` 里信任一次 |

## 安装

```powershell
git clone https://github.com/WU55UY/petdex-overlay.git
cd petdex-overlay
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装脚本会：

1. 把运行时复制到 `%USERPROFILE%\.petdex\overlay\`；
2. 首次安装时写入示例宠物、战利品表，**不覆盖已有存档**；
3. 检测本机的 Codex / Cursor / Kimi Code，合并 hook 配置（修改前自动备份）；
4. 安装 Cursor 的 `/petdex` 斜杠命令；
5. 检查 Python 依赖并启动宠物。

常用参数：

```powershell
# 只装 Codex，不自动启动
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Agents codex -NoStart

# 同时装 Codex + Cursor + Kimi Code
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Agents codex,cursor,kimi
```

> 装完重开一次 IDE，让 hooks 生效。验证：

```powershell
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" doctor
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" status
```

### 手动安装（不想跑脚本）

1. 把 `overlay/` 复制到 `%USERPROFILE%\.petdex\overlay\`，再复制 `hooks/bridge.mjs`、`hooks/delay-down.mjs` 进去。
2. 把 `data/items.json` 复制到 `%USERPROFILE%\.petdex\delta\items.json`。
3. 把 `pets/sample/` 复制到 `%USERPROFILE%\.petdex\pets\sample\`，并创建 `active.json`：`{"slug":"sample"}`。
4. 按 [`integrations/codex`](integrations/codex)、[`integrations/cursor`](integrations/cursor) 或 [`integrations/kimi`](integrations/kimi) 的说明合并 hook 配置，把路径换成你的绝对路径。Codex 用的是 `~/.codex/hooks.json`。

## 使用

```powershell
$pet = "$env:USERPROFILE\.petdex\overlay\petdex.mjs"
node $pet up          # 手动启动（不随 IDE 退出）
node $pet down        # 停止并关掉 watchdog
node $pet status      # 运行状态、当前宠物、仓库摘要
node $pet doctor      # 环境自检
node $pet list        # 已安装宠物
node $pet select boba # 切换宠物
node $pet open        # 开一个待开箱子（等同双击）
node $pet open all    # 全开
node $pet stash       # 打印仓库
node $pet codex       # 打印红品图鉴
node $pet stats       # 开箱统计
node $pet panel codex # 在宠物下方弹出图鉴面板
```

| 鼠标操作 | 效果 |
|----------|------|
| 拖动 | 移动宠物 |
| 单击（280ms 防抖） | 循环：无面板 → 仓库 → 图鉴 → 阅读 → 无 |
| 双击 | 开一个待开盲盒 |
| 滚轮 | 仓库 / 图鉴 / 小说翻页 |
| 右键 | 关闭悬浮层 |

HUD：`今开N · 红N · 累计N · 待开N`。

## 宠物

仓库自带 `pets/sample`（Byte），是一只用来演示精灵图格式的原创猫团子，不是疾风。想换成 petdex 画廊里的宠物：

```powershell
# 用 petdex 官方 CLI 安装到 ~/.codex/pets/your-slug
npx petdex install boba

# 导入到 petdex-overlay
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" add "$env:USERPROFILE\.codex\pets\boba"
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" select boba
```

也可以直接把宠物文件夹放进 `%USERPROFILE%\.petdex\pets\your-slug\`，再 `select`。

### 提交到 Petdex 画廊

[petdex](https://petdex.dev) 是宠物**素材包**的画廊，本仓库是读取该格式的独立 Windows 客户端，两者配套但互不隶属。本次提交的「疾风 (Tempest)」slug 是 `jifeng-q`，当前 `PENDING REVIEW`。画廊提交会进管理员队列，批准或拒绝都会发邮件；拒绝会附原因。**审核中的宠物不能编辑**：`petdex edit` 返回 `only_approved_editable`，描述 / tags / license 都要等审核通过后才能改，且编辑会生成一条待审编辑重新进队列（不用重复 `submit`，限流 10 次 / 24h）。

```sh
npx petdex login                       # OAuth 浏览器授权，凭据存系统钥匙串
npx petdex submit ~/.codex/pets/tempest --license LICENSE_ID   # 首次提交；见下方许可说明
npx petdex edit jifeng-q --desc "..."   # 仅审核通过后可用；也支持 --displayName / --meta / --sprite
```

**字段约束**：`displayName` ≤ 60 字符，`description` ≤ 280 字符，`tags` 逗号分隔。精灵图 8×9 或 8×11 atlas、≥256×256，推荐 1536×1872。九个官方状态是 `idle` / `running-right` / `running-left` / `waving` / `jumping` / `failed` / `waiting` / `running` / `review`（与上面的格式表一致）。

可直接粘贴的描述（`266 字符`，含状态、性格、来源和非官方声明；审核通过后用 `petdex edit jifeng-q --desc "..."` 提交）：

```
Tempest — chibi fan-art pet of the orange-haired Delta Force operator. 9 states: idle, running-right, running-left, waving, jumping, failed, waiting, running, review. Calm under fire, quietly smug after a long tool call. Unofficial; not affiliated with Tencent/TiMi.
```

建议 tags：`delta-force, fan-art, chibi, tempest, agent-pet`。

**授权口径**（对应 [NOTICE](NOTICE.md) 第 4 节）：`credit` 由 OAuth 身份决定，不接受提交表单，所以非官方声明要写进 description；`license` 是 per-pet 字段，`unspecified` 是未声明的诚实默认值，同人素材别默认成宽松许可。可选值 `cc0` / `cc-by` / `cc-by-sa` / `cc-by-nc` / `all-rights-reserved`，由你决定，别让工具替你选。角色与名称归原权利人，Petdex 有 [takedown 流程](https://petdex.dev/legal/takedown)，收到权利人请求即配合下架。个人页的 `github.com/wu55uy` 外链由 Clerk 的 GitHub 账号自动带入、无法在站内改；项目地址已写进个人页 Bio。

本次提交的 slug 是 `jifeng-q`（审核中）；通过后一行命令就能从画廊导回本客户端，形成互相导流：

```powershell
npx petdex install jifeng-q
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" add "$env:USERPROFILE\.codex\pets\jifeng-q"
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" select jifeng-q
```

### 精灵图格式

```
pets/your-slug/
├── pet.json            # id / displayName / description / spritesheetPath
└── spritesheet.png     # 8 列 × 9 行，每帧 192×208（也支持 .webp）
```

| 行 | 状态 | 用途 |
|----|------|------|
| 0 | idle | 空闲 |
| 1 | running-right | 调工具（向右跑） |
| 2 | running-left | 调工具（向左跑） |
| 3 | waving | 一轮结束 / 开箱 |
| 4 | jumping | 用户提交提问 |
| 5 | failed | 错误 |
| 6 | waiting | 等待用户确认 |
| 7 | running | 工作 |
| 8 | review | 审阅 |

示例生成器：`python tools/make-sample-pet.py`（需要 Pillow）。改颜色/表情后重跑即可。

## 盲盒规则

工具数决定箱子档位：

| 本轮工具调用 | 箱子 | 红品基础概率 |
|--------------|------|--------------|
| 0–2 | 手提箱 | 0.5% |
| 3–9 | 小保险箱 | 1% |
| 10+ | 保险柜 | 3% |

完整概率表（白/绿/蓝/紫/金/红）：

| 箱子 | 白 | 绿 | 蓝 | 紫 | 金 | 红 |
|------|----|----|----|----|----|----|
| 手提箱 | 40% | 32% | 18% | 7% | 2.5% | 0.5% |
| 小保险箱 | 15% | 25% | 32% | 18% | 9% | 1% |
| 保险柜 | 4% | 10% | 22% | 38% | 23% | 3% |

保底：

- **软保底**：连续不出红时，红权重按 `1 + 连击/40` 提升，上限 2.8×；金同步吃到 40% 的加成。
- **硬保底**：连续 60 箱无红，下一箱必红。
- **重复红保底**：连续 2 次红都是已有图鉴，下一次红必出新。
- **新图鉴偏向**：出红时未点亮的红权重 ×3.5，已点亮 ×0.45；T0 再 ×0.35，限定 ×0.5。

战利品表在 `data/items.json`，可以整个替换成你自己的主题（保持 `items[]`、`quality`、`value`、`tier` 字段即可）。开箱进度在 `%USERPROFILE%\.petdex\delta\`。

> 内置战利品表是《三角洲行动》玩家向收集数据（521 件），仅用于本地同人玩具；相关名称与数值权利归腾讯 / 天美所有，本项目与其无关联。不想用可在安装后替换 `items.json`。

## 配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `PETDEX_HOME` | `%USERPROFILE%\.petdex` | 数据与运行时根目录 |
| `PETDEX_PYTHONW` | 自动查找 | 指定 `pythonw.exe` |
| `PETDEX_NODE` | 自动查找 | 指定 `node.exe`（Python 调面板时用） |
| `PETDEX_AGENT_PROCESSES` | `Cursor,Kimi Code,Codex,ZCode` | 判定「IDE 是否还开着」的进程名，逗号分隔 |
| `PETDEX_NO_SPAWN` | 未设置 | 设为 `1` 时不真正启动悬浮层，便于测试 |
| `PETDEX_AUTO_EXIT` | 由 hook 设置为 `1` | 没有 IDE 进程 12 秒后自动退出；手动 `up` 不设置 |

暂停 hook（不删配置）：

```powershell
New-Item -ItemType File -Force "$env:USERPROFILE\.petdex\runtime\hooks-disabled"
```

删除该文件即恢复。

## 故障排查

| 现象 | 处理 |
|------|------|
| 宠物不出现 | `node ...\petdex.mjs doctor`；看 `%USERPROFILE%\.petdex\runtime\overlay.log`；确认 `python -c "import PIL, win32py"` 能过 |
| `pythonw.exe not found` | 安装 Python 并勾选 Add to PATH，或 `python -m pip install pillow pywin32` |
| IDE 有反应但宠物不动 | 看 `runtime\boot.log` 是否有 hook 事件；重开 IDE；确认 `hooks.json` / `config.toml` 里有 `bridge.mjs`。Codex 还要在 `/hooks` 里信任一次 |
| 宠物被壁纸挡住 | 某些 Wallpaper Engine 场景也是置顶窗口；把壁纸设为非置顶，或右键宠物重开 |
| 右键关掉后不再出现 | hook 管理的实例会在下次 prompt / workspaceOpen 时重启；也可手动 `up` |
| 多个窗口只显示一只 | 这是设计：全机一只宠物，按会话统计 inflight |

日志：

- `runtime\overlay.log` — Python 悬浮层 stderr
- `runtime\boot.log` — hook 事件与开箱
- `runtime\watchdog.log` — IDE 生命周期

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

默认保留宠物、仓库和图鉴，只移除 hooks 与运行时代码。彻底删除：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -PurgeData
```

## 目录结构

```
petdex-overlay/
├── install.ps1 / uninstall.ps1
├── overlay/
│   ├── petdex_overlay.py      # Win32 分层窗口 + 逐像素 alpha 渲染
│   ├── petdex.mjs             # CLI：up/down/open/panel/doctor...
│   ├── bridge-core.mjs        # hook 事件状态机
│   ├── loot.mjs               # 盲盒算法 + 仓库/图鉴
│   ├── novel.mjs              # 本地 txt 阅读面板
│   └── watchdog.mjs           # 跟随 IDE 生命周期
├── hooks/
│   ├── bridge.mjs             # stdin + 锁 + 调用核心
│   └── delay-down.mjs         # 多窗口关闭防误杀
├── integrations/
│   ├── codex/                 # hooks.json 片段（~/.codex/hooks.json）
│   ├── cursor/                # hooks.json 片段 + /petdex 命令
│   └── kimi/                  # config.toml 片段
├── data/items.json            # 521 件战利品
├── pets/sample/               # 原创示例宠物
├── tools/                     # 精灵图生成 / 预览渲染
├── tests/                     # loot + bridge + CLI 测试
└── docs/                      # README 资源
```

## 测试

```powershell
npm test
npm run check   # 测试 + CLI 冒烟
# 或在没有测试 runner 子进程的环境里分开跑：
node tests/loot.test.mjs
node tests/bridge.test.mjs
node tests/petdex.test.mjs
node tests/codex-hooks.test.mjs
```

测试会在临时目录里跑，不碰 `%USERPROFILE%\.petdex`。

## 隐私

- hook 只读取 `conversation_id` / `session_id` / `reason` 和工具调用计数；不保存 prompt、代码、文件内容。
- 没有网络请求；宠物、仓库、图鉴、阅读进度全部在本地。
- `bridge.mjs` 失败时静默放行，不会阻塞 IDE。

## 致谢 / License

- 精灵图格式与 [petdex](https://github.com/crafter-station/petdex) 生态来自 Crafter Station（MIT）。本项目是独立的 Windows 桌面客户端，不是官方项目。
- 内置《三角洲行动》战利品数据是玩家整理的同人数据，权利归原权利方；仅用于本地娱乐。
- 示例宠物 Byte 与所有代码由本项目以 MIT 发布。

代码：[MIT](LICENSE)。第三方内容说明见 [NOTICE.md](NOTICE.md)。
