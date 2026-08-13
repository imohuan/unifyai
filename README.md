# AI Config Sync

> 基于 opencodex 的 AI 配置同步工具

将 `.opencodex/config.json` 中的模型配置和 MCP 服务器配置同步到多个 AI 开发工具平台。

## 🌟 特性

- ✅ **单一数据源**：`.opencodex/config.json` 作为唯一配置来源
- ✅ **智能元数据补全**：自动从 OpenRouter API 获取 410+ 个模型的完整元数据
- ✅ **本地缓存**：24 小时自动缓存，减少 API 调用
- ✅ **模型 Variants 支持**：完整支持 reasoning effort 和 thinking 配置
- ✅ **多平台支持**：OpenCode、Codex、Claude Code、Reasonix
- ✅ **增量同步**：保留目标平台的其他配置项
- ✅ **自动备份**：每次同步前自动备份配置文件

## 📦 支持平台

| 平台 | 模型同步 | MCP 同步 | 备注 |
|------|---------|---------|------|
| OpenCode | ✓ | ✓ | 完整支持 variants |
| Codex | ✗ | ✓ | opencodex 已支持模型 |
| Claude Code | ✗ | ✓ | opencodex 已支持模型 |
| Reasonix | ✓ | ⚠️ | MCP 格式待调查 |

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 基本用法

```bash
# 首次使用：下载 OpenRouter 模型数据（410+ 个模型）
node src/cli.mjs --update-metadata

# 同步到所有平台
node src/cli.mjs --all

# 同步到指定平台
node src/cli.mjs --platforms opencode,reasonix

# 仅同步模型配置
node src/cli.mjs --models-only --platforms opencode,reasonix

# 仅同步 MCP 配置
node src/cli.mjs --mcp-only

# 预览模式（不实际写入）
node src/cli.mjs --dry-run --all
```

### 列出支持的平台

```bash
node src/cli.mjs --list-platforms
```

## 📖 命令行参数

```
选项:
  -V, --version              显示版本号
  --all                      同步到所有平台
  --platforms <list>         指定平台（逗号分隔）
  --models-only              仅同步模型配置
  --mcp-only                 仅同步 MCP 配置
  --dry-run                  预览模式，不实际写入
  --source <path>            源配置文件路径 (默认: ~/.opencodex/config.json)
  --list-platforms           列出支持的平台
  --update-metadata          更新元数据缓存（从 OpenRouter 下载）
  -v, --verbose              显示详细信息
  -h, --help                 显示帮助信息
```

## 📁 项目结构

```
ai-sync/
├── src/
│   ├── core/
│   │   ├── config-loader.mjs          # 配置加载器
│   │   ├── metadata-fetcher.mjs       # 元数据获取器（OpenRouter API）
│   │   ├── variants-generator.mjs     # Variants 生成器
│   │   └── toml-stable.mjs            # TOML 稳定编辑器
│   ├── adapters/
│   │   ├── base-adapter.mjs           # 适配器基类
│   │   ├── opencode-adapter.mjs       # OpenCode 适配器
│   │   ├── codex-adapter.mjs          # Codex 适配器
│   │   ├── claude-code-adapter.mjs    # Claude Code 适配器
│   │   └── reasonix-adapter.mjs       # Reasonix 适配器
│   └── cli.mjs                        # CLI 主入口
├── .cache/
│   └── openrouter-models.json         # OpenRouter 模型缓存（自动生成）
├── DESIGN.md                          # 详细设计文档
└── README.md
```

## 🔧 工作原理

### 1. 配置加载

从 `.opencodex/config.json` 读取：
- `providers`: provider 配置（baseUrl, apiKey, adapter）
- `customModels`: 自定义模型元数据
- `mcp`: MCP 服务器配置

### 2. 元数据增强

为每个模型补全元数据（按优先级）：
1. 自定义配置（customModels）
2. OpenRouter API 缓存（410+ 模型）
3. 默认值（200K context, 32K output）

**OpenRouter 数据包含**：
- ✅ context_length（上下文窗口）
- ✅ max_completion_tokens（最大输出）
- ✅ architecture.modality（是否支持 vision）
- ✅ reasoning（是否支持推理/思考）
- ✅ supported_parameters（支持的参数）

### 3. 平台适配

每个适配器负责：
- 读取目标平台的现有配置
- 转换为平台特定格式
- 合并配置（保留其他字段）
- 写入配置文件

### 4. Variants 生成

根据 OpenRouter 的 `reasoning` 字段和模型族自动生成 variants：
- **GPT/O1/O3 系列**: `none | low | medium | high | xhigh | max`
- **Claude 系列**: `low | medium | high | xhigh | max` (adaptive thinking)
- **DeepSeek/GLM/Qwen 系列**: `on | off`
- **Kimi 系列**: `low | high | max`

## 📊 OpenRouter 集成

### 缓存机制
- **缓存位置**: `.cache/openrouter-models.json`
- **缓存时效**: 24 小时
- **缓存大小**: ~410 个模型的元数据
- **自动更新**: 缓存过期后自动从 API 获取

### 首次使用

```bash
# 下载 OpenRouter 模型数据
node src/cli.mjs --update-metadata

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

## ⚠️ 注意事项

1. **首次使用**：运行 `--update-metadata` 下载模型数据
2. **网络连接**：首次下载需要访问 OpenRouter API
3. **缓存刷新**：24 小时后自动更新，或手动运行 `--update-metadata`
4. **备份文件**：自动生成 `.bak-{timestamp}` 文件
5. **Reasonix API Key**：使用环境变量存储
   ```bash
   $env:IMOHUAN_API_KEY="sk-xxx"
   ```

## 🐛 已知问题

- Reasonix MCP 配置格式待调查
- Claude Code 不支持 `enabled: false` 字段

## 📄 许可证

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📚 相关项目

- [opencodex](https://github.com/lidge-jun/opencodex) - 本项目的基础
- [OpenRouter](https://openrouter.ai/) - 模型元数据 API
