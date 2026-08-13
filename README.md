# AI Config Sync

> 基于 opencodex 的 AI 配置同步工具

将 `.opencodex/config.json` 中的模型配置和 MCP 服务器配置同步到多个 AI 开发工具平台。

## 🌟 特性

- ✅ **单一数据源**：`.opencodex/config.json` 作为唯一配置来源
- ✅ **智能元数据补全**：自动从 OpenRouter API 和内置数据库获取模型元数据
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
| PenguinHarness | - | - | 待实现 |

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 基本用法

```bash
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

### 更新元数据缓存

```bash
node src/cli.mjs --update-metadata
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
  --update-metadata          更新元数据缓存
  -v, --verbose              显示详细信息
  -h, --help                 显示帮助信息
```

## 📁 项目结构

```
ai-sync/
├── src/
│   ├── core/
│   │   ├── config-loader.mjs        # 配置加载器
│   │   ├── metadata-fetcher.mjs     # 元数据获取器
│   │   ├── model-variants.mjs       # Variants 配置
│   │   ├── variants-generator.mjs   # Variants 生成器
│   │   └── toml-stable.mjs          # TOML 稳定编辑器
│   ├── adapters/
│   │   ├── base-adapter.mjs         # 适配器基类
│   │   ├── opencode-adapter.mjs     # OpenCode 适配器
│   │   ├── codex-adapter.mjs        # Codex 适配器
│   │   ├── claude-code-adapter.mjs  # Claude Code 适配器
│   │   └── reasonix-adapter.mjs     # Reasonix 适配器
│   └── cli.mjs                      # CLI 主入口
├── config/
│   ├── known-models.json            # 已知模型配置
│   └── model-variants.json          # 模型 variants 配置
├── DESIGN.md                        # 详细设计文档
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
2. 静态配置表（known-models.json）
3. OpenRouter API（在线获取）
4. 默认值（200K context, 32K output）

### 3. 平台适配

每个适配器负责：
- 读取目标平台的现有配置
- 转换为平台特定格式
- 合并配置（保留其他字段）
- 写入配置文件

### 4. Variants 生成

根据模型族自动生成 reasoning variants：
- **GPT 系列**: `none | low | medium | high | xhigh | max`
- **Claude 系列**: `low | medium | high | xhigh | max` (adaptive thinking)
- **DeepSeek/GLM 系列**: `on | off`
- **Kimi 系列**: `low | high | max`

## ⚠️ 注意事项

1. **备份**：每次同步前会自动备份配置文件（`.bak-{timestamp}`）
2. **环境变量**：Reasonix 使用环境变量存储 API Key，需要手动设置
3. **MCP 格式**：
   - OpenCode: `mcp.{name}` （不是 `mcp.servers.{name}`）
   - Codex: `[mcp_servers.{name}]`
   - Claude Code: `mcpServers.{name}`
4. **权限**：确保有写入配置文件的权限

## 🐛 已知问题

- Reasonix MCP 配置格式待调查
- PenguinHarness 适配器待实现
- Claude Code 不支持 `enabled: false` 字段

## 📄 许可证

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📚 相关项目

- [opencodex](https://github.com/lidge-jun/opencodex) - 本项目的基础
- [codex-base-ui](https://github.com/imohuan/codex-base-ui) - MCP 配置工具参考
