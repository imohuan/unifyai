# UnifyAI

> Unified AI configuration sync tool for multiple AI development platforms

Sync models and MCP server configurations from OpenCodex to multiple AI development platforms.

## 🌟 特性

- ✅ **智能配置源**：优先从 OpenCodex 代理服务获取模型列表，回退到配置文件
- ✅ **MCP 配置支持**：自动同步 MCP 服务器配置（本地 + 远程）
- ✅ **智能元数据补全**：自动从 OpenRouter API 获取 410+ 个模型的完整元数据
- ✅ **本地缓存**：24 小时自动缓存，减少 API 调用
- ✅ **模型 Variants 支持**：完整支持 reasoning effort 和 thinking 配置
- ✅ **多平台支持**：OpenCode、Codex、Claude Code、Reasonix、PenguinHarness
- ✅ **增量同步**：保留目标平台的其他配置项
- ✅ **自动备份**：每次同步前自动备份配置文件

## 📦 支持平台

| 平台 | 模型同步 | MCP 同步 | 配置路径 |
|------|---------|---------|----------|
| OpenCode | ✓ | ✓ | `~/.config/opencode/opencode.json` |
| Codex | ✗ | ✓ | `~/.config/codex/config.toml` |
| Claude Code | ✗ | ✓ | `~/.config/claude/config.json` |
| Reasonix | ✓ | ✓ | `~/.config/reasonix/config.json` |
| PenguinHarness | ✓ | ✓ | 模型: `.project_config.toml`<br>MCP: `*/system_config.yaml` |

## 🚀 快速开始

### 安装

```bash
# 全局安装
npm install -g unifyai

# 或使用 npx
npx unifyai --help
```

### 配置文件

UnifyAI 支持两种配置路径（按优先级）：

1. **项目配置**：`./mcp.json`（当前目录）
2. **全局配置**：`~/.unifyai/mcp.json`（用户目录）

**首次使用**：复制示例配置文件

```bash
# 创建全局配置目录
mkdir -p ~/.unifyai

# 复制示例配置
cp mcp.example.json ~/.unifyai/mcp.json

# 编辑配置，填入你的 API keys
nano ~/.unifyai/mcp.json
```

**缓存位置**：`~/.unifyai/cache/` - 自动创建

### 基本用法

```bash
# 首次使用：下载 OpenRouter 模型数据（410+ 个模型）
node src/cli.mjs --fetch-metadata

# 同步到 OpenCode（默认）
node src/cli.mjs

# 同步到指定平台
node src/cli.mjs --platforms opencode,reasonix

# 仅同步模型配置
node src/cli.mjs --models-only

# 仅同步 MCP 配置
node src/cli.mjs --mcp-only

# 仅对指定平台同步 MCP（其他平台跳过 MCP，模型照常）
node src/cli.mjs --mcp-only --mcp-platforms codex,opencode

# 全局排除某些 MCP 服务器（所有平台都不同步）
node src/cli.mjs --mcp-exclude node_env,github

# 按平台排除 MCP 服务器（可多次指定，如排除 Codex 内置的 node_env）
node src/cli.mjs --mcp-exclude-for codex=node_env --mcp-exclude-for opencode=some-server

# 组合使用：只同步 opencode 的 MCP，且排除 filesystem
node src/cli.mjs --mcp-only --mcp-platforms opencode --mcp-exclude filesystem

# 预览模式（不实际写入）
node src/cli.mjs --dry-run
```

### 列出支持的平台

```bash
# 人类可读（终端查看）
node src/cli.mjs --list-platforms

# 结构化 JSON（给 UI / 脚本消费）
node src/cli.mjs --list-platforms --json

# JSON 输出示例:
# {
#   "platforms": [
#     { "id": "opencode",   "name": "OpenCode",      "supportsModels": true,  "supportsMcp": true,  "modelStatus": "supported",        "mcpStatus": "supported",        "configPath": "~/.config/opencode/opencode.json", "configFormat": "jsonc" },
#     { "id": "codex",      "name": "Codex",         "supportsModels": false, "supportsMcp": true,  "modelStatus": "not_supported",    "mcpStatus": "supported",        "configPath": "~/.codex/config.toml",              "configFormat": "toml" },
#     { "id": "claudecode", "name": "Claude Code",   "supportsModels": false, "supportsMcp": true,  "modelStatus": "not_supported",    "mcpStatus": "supported",        "configPath": "~/.claude.json",                    "configFormat": "json" },
#     { "id": "reasonix",   "name": "Reasonix",      "supportsModels": true,  "supportsMcp": true,  "modelStatus": "supported",        "mcpStatus": "not_implemented",  "configPath": "~/AppData/Roaming/reasonix/config.toml", "configFormat": "toml" },
#     { "id": "penguin",    "name": "PenguinHarness","supportsModels": true,  "supportsMcp": true,  "modelStatus": "supported",        "mcpStatus": "supported",        "configPath": "~/.penguin/data/default_project/.project_config.toml", "configFormat": "toml" }
#   ]
# }
```

**状态字段**（UI 徽章映射）：
- `modelStatus` / `mcpStatus`: `'supported` → ✓ 绿 | `'not_supported` → ✗ 灰 | `'not_implemented` → ⚠ 黄

## 📖 命令行参数

```
选项:
  -V, --version              显示版本号
  --all                      同步到所有平台
  --platforms <list>         指定平台（逗号分隔，默认: opencode）
  --models-only              仅同步模型配置
  --mcp-only                 仅同步 MCP 配置
  --mcp-platforms <list>     仅对指定平台同步 MCP（逗号分隔），未列出的平台跳过 MCP 同步
  --mcp-exclude <names>      所有平台都排除的 MCP 服务器（逗号分隔）
  --mcp-exclude-for <platform=names>  仅对指定平台排除的 MCP 服务器（可多次指定，如 --mcp-exclude-for codex=node_env,github）
  --dry-run                  预览模式，不实际写入
  --source <path>            源配置文件路径
  --list-platforms           列出支持的平台
  --json                    与 --list-platforms 一起使用，输出 JSON 格式
  --update-metadata          更新元数据缓存（从 OpenRouter 下载）
  -h, --help                 显示帮助信息
```

### MCP 同步过滤

支持在同步前过滤 MCP 服务器，常用于排除某些平台内置的 MCP（如 Codex 的 `node_env`）：

- **全局排除**（所有平台生效）：`--mcp-exclude node_env,github`
- **按平台排除**（可多次指定）：`--mcp-exclude-for codex=node_env --mcp-exclude-for opencode=foo`
- **平台白名单**（只对指定平台同步 MCP）：`--mcp-platforms codex,opencode`

过滤优先级：平台白名单 > 按平台排除 > 全局排除。被排除的服务器会打印 `⊘ 已排除` 提示。

## 📁 Project Structure

```
unifyai/
├── src/
│   ├── core/
│   │   ├── config-loader.mjs          # Configuration loader (OpenCodex proxy service support)
│   │   ├── metadata-fetcher.mjs       # Metadata fetcher (OpenRouter API)
│   │   ├── variants-generator.mjs     # Variants generator
│   │   └── toml-stable.mjs            # TOML stable editor
│   ├── adapters/
│   │   ├── base-adapter.mjs           # Base adapter
│   │   ├── opencode-adapter.mjs       # OpenCode adapter
│   │   ├── codex-adapter.mjs          # Codex adapter
│   │   ├── claude-code-adapter.mjs    # Claude Code adapter
│   │   ├── reasonix-adapter.mjs       # Reasonix adapter
│   │   └── penguin-adapter.mjs        # PenguinHarness adapter
│   └── cli.mjs                        # CLI entry point
├── mcp.example.json                   # MCP config example
└── README.md

~/.unifyai/                            # User config directory
├── mcp.json                           # Your MCP configuration
└── cache/
    └── openrouter-models.json         # OpenRouter model cache (auto-generated)
```

## 🔧 工作原理

### 1. 配置加载

**优先级顺序**：
1. **OpenCodex 代理服务** (http://localhost:10100/models) - 实时获取模型列表
2. **配置文件** (`~/.opencodex/config.json`) - 回退方案

从配置文件中读取：
- `providers`: provider 配置（baseUrl, apiKey, adapter）
- `customModels`: 自定义模型元数据
- `mcp.mcpServers`: MCP 服务器配置

### 2. MCP 配置加载

**配置路径优先级**：
1. `./mcp.json`（当前工作目录）
2. `~/.unifyai/mcp.json`（用户配置目录）

**配置格式** (`mcp.json`):
```json
{
  "mcpServers": {
    "filesystem": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    },
    "remote-server": {
      "type": "remote",
      "enabled": true,
      "url": "https://mcp-gateway.example.com",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

参考 `mcp.example.json` 获取更多配置示例。

### 3. 元数据增强

为每个模型补全元数据（按优先级）：
1. 自定义配置（customModels）
2. OpenRouter API 缓存（410+ 模型）
3. 默认值（200K context, 32K output）

**OpenRouter 数据包含**：
- ✅ context_length（上下文窗口）
- ✅ max_completion_tokens（最大输出）
- ✅ architecture.modality（是否支持 vision）
- ✅ reasoning（是否支持推理/思考，修复为 null）
- ✅ supported_parameters（支持的参数）

### 4. 平台适配

#### OpenCode 适配器
- **模型配置**：写入 `config.provider[providerKey]`
- **MCP 配置**：写入 `config.mcp` (不是 `config.mcpServers`)
- **格式**：
  ```json
  {
    "mcp": {
      "filesystem": {
        "type": "local",
        "enabled": true,
        "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "D:/Code"]
      },
      "remote-server": {
        "type": "remote",
        "enabled": true,
        "url": "https://example.com",
        "headers": {
          "Authorization": "Bearer sk-xxx"
        }
      }
    }
  }
  ```

#### Codex / Claude Code 适配器
- **MCP 配置**：写入 `mcpServers` 顶层字段
- **格式**：TOML (Codex) 或 JSON (Claude Code)

#### Reasonix 适配器
- **模型配置**：写入 `model.custom` 数组
- **MCP 配置**：写入 `mcp.server` 数组

### 5. Variants 生成

根据 OpenRouter 的 `reasoning` 字段和模型族自动生成 variants：
- **GPT/O1/O3 系列**: `none | low | medium | high | xhigh | max`
- **Claude 系列**: `low | medium | high | xhigh | max` (adaptive thinking)
- **DeepSeek/GLM/Qwen 系列**: `on | off`
- **Kimi 系列**: `low | high | max`

## 📊 OpenRouter 集成

### 缓存机制
- **缓存位置**: `~/.unifyai/cache/openrouter-models.json`
- **缓存时效**: 24 小时
- **缓存大小**: ~410 个模型的元数据
- **自动更新**: 缓存过期后自动从 API 获取

### 首次使用

```bash
# 下载 OpenRouter 模型数据
node src/cli.mjs --fetch-metadata

# 输出:
# 🔄 更新元数据缓存...
# 🔄 从 OpenRouter API 获取模型数据...
# ✓ OpenRouter 数据已更新: 410 个模型
# ✓ 元数据缓存已更新
```

### 模糊匹配

支持多种模型名称格式：
```
deepseek-v4-pro        → openai/deepseek-chat
claude-opus-5          → anthropic/claude-3-opus-20240229
gpt-5.6-luna           → openai/o1-preview
```

## 🔨 最近修复

### v1.0.1 (2025-01-13)

1. **修复 reasoning 字段 bug**
   - 将 `reasoning: false` 改为 `reasoning: null`
   - 避免 OpenCode 类型错误

2. **优化配置加载**
   - 优先从 OpenCodex 代理服务 (http://localhost:10100/models) 获取模型列表
   - 失败时自动回退到配置文件

3. **修复 MCP 配置同步**
   - 正确处理 `config.mcp.mcpServers` 嵌套结构
   - 修复 OpenCode 适配器写入位置（`config.mcp` 而不是 `config.mcpServers`）
   - 支持本地和远程 MCP 服务器

4. **改进 CLI 体验**
   - 添加详细的同步日志输出
   - 改进错误提示信息

## ⚠️ 注意事项

1. **首次使用**：运行 `--fetch-metadata` 下载模型数据
2. **配置文件**：将 `mcp.example.json` 复制到 `~/.unifyai/mcp.json` 并填入你的配置
3. **安全性**：不要将包含 API keys 的 `mcp.json` 提交到版本控制
4. **OpenCodex 代理服务**：确保 `http://localhost:10100` 可访问（推荐）
5. **网络连接**：首次下载需要访问 OpenRouter API
6. **缓存刷新**：24 小时后自动更新，或手动运行 `--fetch-metadata`
7. **备份文件**：自动生成 `.bak-{timestamp}` 文件
8. **MCP 配置路径**：
   - OpenCode: 写入 `config.mcp`
   - Codex/Claude Code: 写入 `mcpServers` 顶层字段
   - Reasonix: 写入 `mcp.server` 数组

## 🐛 已知问题

- Reasonix MCP 配置格式需要进一步测试
- Claude Code 不支持 `enabled: false` 字段

## 📄 许可证

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📚 相关项目

- [opencodex](https://github.com/lidge-jun/opencodex) - OpenCodex 代理服务
- [OpenRouter](https://openrouter.ai/) - 模型元数据 API
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP 协议规范
