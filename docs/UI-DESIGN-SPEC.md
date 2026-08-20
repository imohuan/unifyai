# UnifyAI — UI 设计规范文档

> 本文档面向 UI 设计师，完整描述了 UnifyAI（多平台 AI 配置同步工具）的所有功能、数据流、交互状态与边界情况，作为 UI 设计的唯一依据。
> 工具本质：**把模型配置和 MCP 配置从「源」同步到 5 个 AI 开发平台的本地配置文件**。

---

## 目录

1. [产品定位与核心概念](#1-产品定位与核心概念)
2. [平台能力矩阵](#2-平台能力矩阵)
3. [完整功能清单](#3-完整功能清单)
4. [MCP 同步过滤（核心新功能）](#4-mcp-同步过滤核心新功能)
5. [配置系统](#5-配置系统)
6. [同步工作流程（状态机）](#6-同步工作流程状态机)
7. [各平台配置写入格式](#7-各平台配置写入格式)
8. [输出与日志格式](#8-输出与日志格式)
9. [错误与边界情况](#9-错误与边界情况)
10. [UI 页面结构与组件建议](#10-ui-页面结构与组件建议)
11. [交互场景示例](#11-交互场景示例)

---

## 1. 产品定位与核心概念

### 1.1 一句话定位

用户在 OpenCodex 代理（或 `mcp.json`）中统一配置模型和 MCP 服务器，UnifyAI 将这些配置一键同步到 OpenCode、Codex、Claude Code、Reasonix、PenguinHarness 五个平台的本地配置文件中。

### 1.2 两个数据域（UI 的顶层概念）

| 数据域 | 说明 | 同步模式 |
|--------|------|---------|
| **模型 (Models)** | 从 OpenCodex 代理/Provider API 获取的模型列表（含元数据：上下文窗口、vision、thinking、variants） | 全量覆盖写平台配置 |
| **MCP (MCP Servers)** | 从 `mcp.json` 读取的 MCP 服务器配置（本地 stdio + 远程 http） | 增量合并（同名覆盖，保留未同步项） |

### 1.3 关键设计决策（已与用户确认）

- **模型不做增删改查**：模型在 OpenCodex 平台侧管理，UnifyAI 只负责「一键同步」到各平台。
- **MCP 增强管理**：核心是**同步前过滤**——排除某些平台不需要/内置的 MCP 服务器（如 Codex 内置的 `node_env`）。
- **过滤规则只用 CLI 参数**（不做配置文件持久化方案），但 UI 可以「可视化拼装 CLI 命令」。

---

## 2. 平台能力矩阵

> UI 必须如实反映：**不是所有平台都支持模型同步**。Codex 和 Claude Code 只支持 MCP 同步；Reasonix 的 MCP 同步是未实现状态（代码里直接跳过）。

| 平台 | CLI 标识 | 模型同步 | MCP 同步 | 配置文件路径 | 文件格式 |
|------|---------|:-------:|:-------:|-------------|---------|
| OpenCode | `opencode` | ✅ | ✅ | `~/.config/opencode/opencode.json` | JSONC（支持注释） |
| Codex | `codex` | ❌ 不支持 | ✅ | `~/.codex/config.toml` | TOML |
| Claude Code | `claudecode` | ❌ 不支持 | ✅ | `~/.claude.json` | JSON |
| Reasonix | `reasonix` | ✅ | ⚠️ 未实现（跳过） | `%APPDATA%/reasonix/config.toml` | TOML |
| PenguinHarness | `penguin` | ✅ | ✅ | 模型: `~/.penguin/data/default_project/.project_config.toml`<br>MCP: `~/.penguin/data/*/system_config.yaml`（搜索所有） | TOML / YAML |

### 2.1 UI 展示建议

- 平台选择用「卡片 + 能力徽章」：每张卡片显示平台名、模型徽章（✅/❌）、MCP 徽章（✅/⚠️/❌）。
- 用户选择了不支持的能力时，该平台卡片应置灰或提示「该平台不支持模型同步」。

---

## 3. 完整功能清单

> 所有 CLI 参数都要映射为 UI 控件。下表是 UI 控件的需求来源。

### 3.1 参数总表

| 参数 | 类型 | 默认值 | 作用 | UI 控件建议 |
|------|------|--------|------|------------|
| `--all` | 开关 | 无 | 同步到全部 5 个平台 | 「全部平台」勾选框 |
| `--platforms <list>` | 多选列表 | `opencode,codex,claudecode,reasonix,penguin` | 指定同步目标平台 | 平台多选卡片组 |
| `--models-only` | 开关 | 无 | 仅同步模型，跳过 MCP | 同步内容单选：「仅模型」 |
| `--mcp-only` | 开关 | 无 | 仅同步 MCP，跳过模型 | 同步内容单选：「仅 MCP」 |
| `--mcp-platforms <list>` | 多选列表 | 无（全部） | **只对指定平台同步 MCP**，未列出的平台跳过 MCP | 「MCP 目标平台」多选 |
| `--mcp-exclude <names>` | 文本/标签列表 | 无 | **所有平台都排除**的 MCP 服务器名 | 全局排除标签输入器 |
| `--mcp-exclude-for <platform=names>` | 键值列表，**可多次指定** | 无 | **只对指定平台排除**的 MCP 服务器名 | 平台×服务器 排除矩阵 |
| `--dry-run` | 开关 | 无 | 预览模式：只显示将要做什么，不写文件 | 「预览」按钮 / 切换开关 |
| `--source <path>` | 文件路径 | `~/.opencodex/config.json` | 模型源配置文件路径 | 设置页路径输入 |
| `--list-platforms` | 动作 | 无 | 列出平台及能力 | 帮助/关于 |
| `--update-metadata` | 动作 | 无 | 强制刷新 OpenRouter 模型元数据缓存 | 「更新元数据」按钮 |
| `--verbose` | 开关 | 无 | 显示详细堆栈信息 | 高级设置开关 |

> ⚠️ 注意：CLI 代码里是 `--update-metadata`（README 旧文档写的 `--fetch-metadata` 已失效，UI 以本表为准）。

### 3.2 同步内容的三态选择

```
同步内容：
  ( ) 全部同步（模型 + MCP）
  ( ) 仅模型  (--models-only)
  ( ) 仅 MCP   (--mcp-only)
```

- 「仅模型」时：MCP 过滤相关控件应**禁用/隐藏**。
- 「仅 MCP」时：模型列表展示可隐藏，MCP 过滤控件启用。

### 3.3 平台选择的两种模式

| 模式 | 触发 | 行为 |
|------|------|------|
| 指定平台 | 勾选 `--platforms` | 只同步勾选的平台 |
| 全部平台 | 勾选 `--all` | 忽略 platforms，同步全部 5 个 |

UI 建议：`--all` 用「全部」主开关，选中后平台多选全部打勾且锁定。

---

## 4. MCP 同步过滤（核心新功能）

### 4.1 三个过滤维度（UI 的核心交互区）

```
维度1: 全局排除（--mcp-exclude）
  所有平台都不同步这些 MCP 服务器
  例: --mcp-exclude node_env,github

维度2: 按平台排除（--mcp-exclude-for，可多次）
  只对指定平台排除，其他平台照常同步
  例: --mcp-exclude-for codex=node_env --mcp-exclude-for opencode=foo

维度3: 平台白名单（--mcp-platforms）
  只有列出的平台才执行 MCP 同步，未列出平台完全跳过 MCP
  例: --mcp-platforms codex,opencode
```

### 4.2 过滤优先级（必须遵守）

```
① 平台白名单（--mcp-platforms）—— 不在名单 → 该平台 MCP 全部跳过
② 按平台排除（--mcp-exclude-for）+ 全局排除（--mcp-exclude）—— 取并集，命中即排除
```

> 白名单是「平台级」门禁；排除是「服务器级」过滤。两者叠加生效。

### 4.3 典型用例（Codex 内置 MCP 排除）

Codex CLI 内部自带 `node_env` 等 MCP，同步时不应覆盖/触碰。推荐命令：

```bash
unifyai --mcp-only --mcp-exclude-for codex=node_env
```

### 4.4 UI 设计建议：排除矩阵

建议用「表格/矩阵」形式，行 = MCP 服务器（来自 `mcp.json`），列 = 平台：

```
MCP 服务器     │ OpenCode │ Codex │ Claude Code │ Reasonix │ Penguin
───────────────┼──────────┼───────┼─────────────┼──────────┼────────
filesystem     │   ✓      │  ✓    │     ✓       │   ✓     │   ✓
node_env       │   ✓      │  ✕    │     ✓       │   ✓     │   ✓   ← 只对 Codex 排除
github         │   ✕      │  ✕    │     ✕       │   ✕     │   ✕   ← 全局排除
```

- 单元格点击切换 ✓/✕。
- 整行 ✕ = 全局排除（映射为 `--mcp-exclude`）。
- 单个 ✕ = 按平台排除（映射为 `--mcp-exclude-for 平台=服务器`）。
- 提供「显示被排除项」的筛选开关。

---

## 5. 配置系统

### 5.1 模型源配置（OpenCodex）

- 路径：`--source` 参数，默认 `~/.opencodex/config.json`
- 结构：
```json
{
  "port": 10100,
  "providers": {
    "IMOHUAN": {
      "baseUrl": "http://localhost:10100/v1",
      "apiKey": "sk-xxx",
      "defaultModel": "deepseek-v4-pro"
    }
  },
  "mcp": {
    "mcpServers": { ... }
  }
}
```

### 5.2 模型获取的降级链路（UI 需展示数据来源）

```
① OpenCodex 代理服务  http://localhost:10100/v1/models（3 秒超时）
   ├─ 成功 → 使用代理返回的统一模型列表
   └─ 失败 ↓
② 逐个 Provider API  GET {baseUrl}/models（需 baseUrl + apiKey）
   ├─ 成功 → 合并各 provider 模型
   └─ 失败 → 警告，该 provider 无模型
```

UI 建议：展示「模型来源」状态条（如 `来源: OpenCodex 代理 | 372 个模型` 或 `来源: 降级逐个 Provider | 数量`）。

### 5.3 MCP 源配置（mcp.json）

- 优先级：`./mcp.json`（当前目录）> `~/.unifyai/mcp.json`（用户目录）
- 结构（UI 的 MCP 服务器列表数据源）：
```json
{
  "mcpServers": {
    "filesystem": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path"]
    },
    "remote-server": {
      "type": "remote",
      "enabled": true,
      "url": "https://mcp-gateway.example.com",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}
```
- `disabled: true` 的服务器会被自动过滤（不参与同步）。
- 本地服务器字段：`type=local`、`command[]`
- 远程服务器字段：`type=remote`、`url`、`headers.Authorization`

### 5.4 元数据缓存

- 位置：`~/.unifyai/cache/openrouter-models.json`
- 内容：OpenRouter 410+ 模型元数据（context / output / vision / reasoning）
- TTL：24 小时自动过期；`--update-metadata` 强制刷新
- 增强优先级：自定义配置 > OpenRouter 缓存 > 默认值（200K context / 32K output）

---

## 6. 同步工作流程（状态机）

### 6.1 完整执行序列

```
┌─────────────────────────────────────────────────────────┐
│ 1. 加载模型源配置 (--source)                            │
│ 2. 获取模型列表 (代理 → 降级 Provider)                   │
│ 3. 加载 MCP 配置 (./mcp.json → ~/.unifyai/mcp.json)     │
│ 4. 增强模型元数据 (OpenRouter 缓存)                      │
│ 5. 选择目标平台 (--all / --platforms)                    │
│ 6. 按平台过滤 MCP (白名单 → 全局/按平台排除)             │
│ 7. 逐平台执行:                                          │
│    a. 备份原配置文件 → xxx.bak-{时间戳}                 │
│    b. 同步模型 (若该平台支持 && 未跳过)                  │
│    c. 同步 MCP (若该平台支持 && 未跳过 && 未过滤空)      │
│ 8. 汇总报告 (成功/失败计数)                             │
└─────────────────────────────────────────────────────────┘
```

### 6.2 UI 状态流转

| 状态 | 说明 | UI 表现 |
|------|------|---------|
| 待配置 | 用户尚未执行 | 表单可编辑，执行按钮可用 |
| 预览中 | `--dry-run` | 只读输出流，显示「将同步 X 个模型 / Y 个 MCP」 |
| 执行中 | 逐平台进行 | 每个平台显示进度状态（进行中/成功/失败） |
| 完成 | 全部结束 | 汇总面板：成功 N 平台 / 失败 M 平台，失败详情列表 |
| 失败 | 某平台报错 | 该平台标红，可展开错误信息（verbose 显示堆栈） |

### 6.3 每个平台内部的同步条件（UI 需提示用户）

| 条件 | 结果 |
|------|------|
| 平台不支持模型 && 请求同步模型 | 跳过模型，提示「该平台不支持模型同步」 |
| 平台不支持 MCP && 请求同步 MCP | 跳过 MCP，提示「该平台不支持 MCP 同步」 |
| 平台配置文件不存在 | 警告并跳过该平台，不写文件 |
| Reasonix 请求同步 MCP | 提示「MCP 配置格式待调查，暂时跳过」 |
| MCP 被过滤后为空 | 跳过 MCP 同步 |

---

## 7. 各平台配置写入格式

> UI 的「预览将要写入的内容」功能可参考此节。也用于理解各平台配置差异。

### 7.1 OpenCode（JSONC）

- 模型写入：`config.provider[providerKey]`，**全量清空重写**（`config.provider = {}`）
  - `providerKey = provider名小写-sdk名`（如 `imohuan-openai`）
  - 模型按 SDK 分组：`@ai-sdk/openai`、`@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/mistral`、`@ai-sdk/cohere`、`@ai-sdk/xai`、`@ai-sdk/openai-compatible`
- MCP 写入：`config.mcp[name]`（注意不是 `mcpServers`），同名覆盖，保留未同步项
- **风险提示**：模型同步是全量覆盖，用户手动配置的其他 provider 会被清掉 → UI 应在执行前弹出确认

### 7.2 Codex（TOML）

- MCP 写入：顶层 `[mcp_servers.NAME]`，同名覆盖，保留其他 section
- 远程服务器字段：`url`、`enabled`、`http_headers.Authorization`（Codex 专用字段名）
- 本地服务器字段：`command`、`args`、`enabled`、`env`
- 模型：**不支持**（由 opencodex 代理）

### 7.3 Claude Code（JSON）

- MCP 写入：顶层 `mcpServers[name]`，同名覆盖，保留其他
- **不支持 `enabled` 字段**：`enabled: false` 的服务器会从配置中**删除**而非禁用
- 远程：`{ type: "sse" | "streamable-http", url }`；本地：`{ command, args, env }`

### 7.4 Reasonix（TOML）

- 模型写入：`providers[]` 数组，按 provider 名匹配更新或新增；模型列表写 `provider.models[]`
- MCP 写入：**未实现**（TODO）

### 7.5 PenguinHarness（TOML + YAML）

- 模型写入：`~/.penguin/data/default_project/.project_config.toml`，重建 `[[models]]` 段（保留 `default_model` 行）
- MCP 写入：搜索 `~/.penguin/data/` 下所有 `system_config.yaml`，更新 `tools.mcpServers[]`，同名更新/新增（增量）
- YAML 回写：`yaml.dump`，indent 2

---

## 8. 输出与日志格式

> UI 的「实时日志面板」应尽量还原以下关键信息层级。

### 8.1 启动信息
```
🚀 AI Config Sync - 配置同步工具
📂 加载配置: {path}
✓ 加载配置: N 个 provider
```

### 8.2 模型获取
```
✓ 从 OpenCodex 代理服务获取模型列表 (http://localhost:10100)
  ✓ 获取到 372 个模型
⚠ OpenCodex 代理服务不可用，降级到逐个 provider 获取
📡 获取 IMOHUAN 的模型列表...
  ✓ 获取到 372 个模型
```

### 8.3 MCP 加载
```
✓ MCP 配置 (来自 cwd): 3/3 个服务器启用
⚠ mcp.json 不存在（已尝试 cwd 和 ~/.unifyai），跳过 MCP 同步
```

### 8.4 过滤提示（新功能）
```
⊘ codex: MCP 同步已跳过（不在 --mcp-platforms 白名单）
⊘ 已排除 MCP: node_env, github
→ 将同步 2 个 MCP 服务器 (排除 node_env, github)   [dry-run]
```

### 8.5 平台同步
```
📦 同步到 Codex...
  💾 备份: config.toml.bak-1724134567890
  → 同步 MCP 配置 (2 个)
    • filesystem: stdio
    • github: remote
  ✓ Codex 同步成功
```

### 8.6 汇总
```
==================================================
✓ 成功: 2 个平台
✗ 失败: 1 个平台

失败详情:
  • reasonix: xxx 同步失败: {error}
==================================================
```

### 8.7 图标语义（UI 复用）

| 图标 | 含义 |
|------|------|
| ✅ ✓ | 成功 |
| ⚠ | 警告/降级/跳过 |
| ❌ ✗ | 失败 |
| ⊘ | 排除/跳过（过滤） |
| 💾 | 备份 |
| 📦 | 平台同步开始 |
| 🔄 | 进行中/刷新 |
| 🧠 | 支持思考 | 
| 👁️ | 支持视觉 |

---

## 9. 错误与边界情况

| 场景 | 行为 | UI 建议 |
|------|------|---------|
| `--source` 文件不存在 | 抛错退出：「配置文件不存在: {path}」 | 表单校验，路径选择器 |
| 未知平台名 | 警告「未知平台」，计入失败 | 平台卡片来自固定枚举，UI 不提供自由输入 |
| OpenCodex 代理不可用 | 静默降级（3 秒超时） | 状态条显示「已降级」 |
| Provider 缺 baseUrl/apiKey | 警告跳过该 provider | 设置页提示 |
| OpenRouter API 失败 | 使用旧缓存 → 无缓存则空元数据 | 不阻塞主流程，提示「元数据不可用」 |
| mcp.json 缺失 | 跳过 MCP 同步，模型照常 | 提示「未找到 MCP 配置」 |
| mcp.json 无 mcpServers 字段 | 警告格式错误，MCP 跳过 | 配置校验 |
| 备份失败 | 警告但不中断同步 | 日志警告 |
| 目标平台配置文件不存在 | 跳过该平台（不创建） | 平台卡片显示「配置文件缺失」 |
| 全部平台都失败 | 退出码 1 | 汇总面板全红 |
| `--mcp-only` + 某平台不支持 MCP | 该平台无操作 | 卡片提示 |
| 同一 MCP 服务器名在平台已存在 | 覆盖（增量更新） | 预览中标注「将覆盖」 |
| Claude Code 的 enabled:false 服务器 | 从配置中删除 | 预览中标注「将删除」 |

---

## 10. UI 页面结构与组件建议

### 10.1 建议页面结构（单页工具型）

```
┌──────────────────────────────────────────────────────────┐
│ Header: UnifyAI  |  设置 ⚙  |  帮助 ?                      │
├──────────────────────────────────────────────────────────┤
│ ① 同步内容选择                                            │
│    [全部同步] [仅模型] [仅 MCP]   (三选一，SegmentedControl)│
├──────────────────────────────────────────────────────────┤
│ ② 目标平台选择                                            │
│    [☑ 全部平台]                                           │
│    [🟢 OpenCode 模型✓ MCP✓] [🔵 Codex 模型✗ MCP✓] ...     │
│    （卡片多选，能力徽章）                                  │
├──────────────────────────────────────────────────────────┤
│ ③ MCP 过滤配置（仅「全部/仅MCP」时启用）                  │
│    Tab1: 排除矩阵（服务器×平台表格）                      │
│    Tab2: MCP 目标平台白名单（--mcp-platforms 多选）        │
├──────────────────────────────────────────────────────────┤
│ ④ 数据预览（可选折叠）                                    │
│    模型来源: OpenCodex 代理 | 372 个模型                   │
│    MCP 来源: ./mcp.json | 3/3 启用                        │
│    [预览将要执行的命令]                                    │
├──────────────────────────────────────────────────────────┤
│ ⑤ 操作区                                                  │
│    [预览 (dry-run)]  [开始同步]                           │
├──────────────────────────────────────────────────────────┤
│ ⑥ 结果/日志面板                                           │
│    实时滚动日志 + 汇总卡片（成功 N / 失败 M）              │
└──────────────────────────────────────────────────────────┘
```

### 10.2 关键组件规格

| 组件 | 规格 |
|------|------|
| 平台卡片 | 平台名、模型徽章、MCP 徽章、配置路径（hover 显示）、选中态、禁用态（不支持所选能力时置灰） |
| 排除矩阵 | 行=服务器（来自 mcp.json 实时读取），列=平台；单元格三态：默认✓ / 单平台✕ / 全平台✕；表头提供「排除全部」「恢复全部」 |
| 命令预览 | 实时把 UI 状态翻译成 CLI 命令文本（等宽字体），如 `unifyai --mcp-only --mcp-exclude-for codex=node_env` |
| 日志面板 | 等宽字体、按图标着色（绿=成功 黄=警告 红=失败）、自动滚动、可复制 |
| 汇总卡片 | 成功/失败大数字、失败平台可展开错误详情 |
| 平台详情折叠 | 每个平台展示：配置文件路径、将写入的模型数、将写入的 MCP 数、将覆盖/删除的项 |

### 10.3 执行前确认弹窗

当满足以下任一条件时，执行前必须弹确认：
- 目标包含 OpenCode 且同步模型 → 警告「模型同步将**清空重写** OpenCode 的 provider 配置」
- 有平台配置文件将被覆盖 → 提示「已自动备份为 .bak-{时间戳}」
- Claude Code 存在 enabled:false 的服务器 → 提示「将从 Claude 配置中删除」

### 10.4 设置页（可选）

- `--source` 路径配置
- 元数据缓存管理：查看缓存时间、[强制更新]（`--update-metadata`）
- 高级：`--verbose` 开关

---

## 11. 交互场景示例

### 场景 A：一键同步全部（最常见）
```
用户操作: [全部同步] + [☑ 全部平台] + [开始同步]
CLI 等价: unifyai --all
预期结果: 5 个平台全部执行；codex/claudecode 提示「不支持模型」只同步 MCP；
          reasonix 提示「MCP 跳过」只同步模型；penguin 模型+MCP 全量。
```

### 场景 B：只同步 MCP 且排除 Codex 内置 node_env
```
用户操作: [仅 MCP] + 平台全选 + 排除矩阵中 codex 列 node_env 行打✕ + [开始同步]
CLI 等价: unifyai --mcp-only --mcp-exclude-for codex=node_env
预期结果: 各平台同步 MCP，Codex 的 node_env 被跳过并显示 ⊘。
```

### 场景 C：只想让 opencode 和 codex 同步 MCP
```
用户操作: [仅 MCP] + MCP 白名单勾选 opencode,codex
CLI 等价: unifyai --mcp-only --mcp-platforms opencode,codex
预期结果: 其他平台显示「⊘ MCP 同步已跳过（不在白名单）」，模型不受影响。
```

### 场景 D：执行前预览
```
用户操作: 配置好后点 [预览 (dry-run)]
CLI 等价: 追加 --dry-run
预期结果: 输出「将同步 X 个模型 / Y 个 MCP (排除 …)」，不写任何文件。
```

### 场景 E：模型来源降级
```
条件: OpenCodex 代理未启动
预期结果: 状态条显示「已降级到逐个 Provider」，模型仍可用（如有 apiKey）。
```

---

## 附录 A：完整命令示例速查

```bash
# 基本
unifyai                          # 同步到默认平台列表（全部 5 个）
unifyai --all                    # 同步到所有平台
unifyai --platforms opencode,codex   # 只同步这两个平台

# 内容控制
unifyai --models-only            # 只同步模型
unifyai --mcp-only               # 只同步 MCP

# MCP 过滤（v1.0.5+）
unifyai --mcp-exclude node_env,github              # 全局排除
unifyai --mcp-exclude-for codex=node_env           # 按平台排除（可多次）
unifyai --mcp-exclude-for codex=node_env --mcp-exclude-for opencode=foo
unifyai --mcp-platforms codex,opencode             # MCP 平台白名单
unifyai --mcp-only --mcp-exclude-for codex=node_env --mcp-exclude filesystem

# 其他
unifyai --dry-run                 # 预览
unifyai --update-metadata         # 刷新元数据缓存
unifyai --list-platforms          # 列出平台能力（人类可读）
unifyai --list-platforms --json   # 列出平台能力（结构化 JSON，供 UI 消费）
unifyai --source ~/.opencodex/config.json --verbose
```

## 附录 B：UI 需要的数据来源（后端建议提供）

| 数据 | 来源 | 用途 |
|------|------|------|
| **平台列表及能力** | `unifyai --list-platforms --json`（结构化输出） | 平台卡片（模型✓/✗、MCP✓/⚠/✗ 徽章） |
| MCP 服务器列表 | 读取 `./mcp.json` / `~/.unifyai/mcp.json` | 排除矩阵、预览 |
| 模型列表及元数据 | OpenCodex 代理/Provider API | 预览、数量统计 |
| 各平台现有配置 | 读取各平台配置文件 | 「将覆盖/将删除」标注 |
| 命令文本 | UI 状态 → CLI 参数翻译 | 命令预览 |

### B.1 平台列表 JSON 结构（`--list-platforms --json` 输出）

> 以下为 **v1.0.x 实测输出**（Windows，node src/cli.mjs --list-platforms --json），可直接作为 UI 开发联调的预期数据。

```json
{
  "platforms": [
    {
      "id": "opencode",
      "name": "OpenCode",
      "supportsModels": true,
      "modelStatus": "supported",
      "supportsMcp": true,
      "mcpStatus": "supported",
      "configPath": "~/.config/opencode/opencode.json",
      "configFormat": "jsonc"
    },
    {
      "id": "codex",
      "name": "Codex",
      "supportsModels": false,
      "modelStatus": "not_supported",
      "supportsMcp": true,
      "mcpStatus": "supported",
      "configPath": "~/.codex/config.toml",
      "configFormat": "toml"
    },
    {
      "id": "claudecode",
      "name": "Claude Code",
      "supportsModels": false,
      "modelStatus": "not_supported",
      "supportsMcp": true,
      "mcpStatus": "supported",
      "configPath": "~/.claude.json",
      "configFormat": "json"
    },
    {
      "id": "reasonix",
      "name": "Reasonix",
      "supportsModels": true,
      "modelStatus": "supported",
      "supportsMcp": true,
      "mcpStatus": "not_implemented",
      "configPath": "~/AppData/Roaming/reasonix/config.toml",
      "configFormat": "toml"
    },
    {
      "id": "penguin",
      "name": "PenguinHarness",
      "supportsModels": true,
      "modelStatus": "supported",
      "supportsMcp": true,
      "mcpStatus": "supported",
      "configPath": "~/.penguin/data/default_project/.project_config.toml",
      "configFormat": "toml"
    }
  ]
}
```

**状态字段 UI 映射**：
- `modelStatus: 'supported'` → 模型徽章 ✓（绿）
- `modelStatus: 'not_supported'` → 模型徽章 ✗（灰）
- `mcpStatus: 'supported'` → MCP 徽章 ✓（绿）
- `mcpStatus: 'not_implemented'` → MCP 徽章 ⚠（黄，hover 提示「MCP 同步未实现，将跳过」）
- `mcpStatus: 'not_supported'` → MCP 徽章 ✗（灰）

**字段说明**：
- `id`：CLI 参数中使用的平台标识（如 `--platforms codex`），UI 勾选平台时用此值
- `name`：展示名称
- `supportsModels` / `supportsMcp`：布尔兼容字段（与 `*Status` 冗余，二选一即可）
- `modelStatus` / `mcpStatus`：三态能力状态（UI 徽章用此字段）
- `configPath`：已自动把用户目录替换为 `~`（Windows 下分隔符统一为 `/`），UI 可直接展示
- `configFormat`：配置文件格式（`jsonc` / `json` / `toml` / `yaml`），UI 可据此选择语法高亮

---

*文档版本: v1.0 | 对应代码: unifyai v1.0.x | 更新日期: 2026-08-20*
