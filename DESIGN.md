# AI Config Sync - 详细设计文档

## 一、项目概述

### 1.1 项目目标
基于 [opencodex](https://github.com/lidge-jun/opencodex) 项目，创建一个配置同步工具，将 `.opencodex/config.json` 中的配置（模型 + MCP）同步到其他 AI 开发工具平台。

### 1.2 核心理念
- **单一数据源**：`.opencodex/config.json` 作为唯一配置源
- **opencodex 已支持的平台**：Codex 和 Claude Code 的模型配置由 opencodex 原生支持，只需同步 MCP
- **需要完整同步的平台**：OpenCode、Reasonix、PenguinHarness 需要同步模型和 MCP
- **保留现有配置**：同步时保留目标平台的其他配置项
- **模型显示名称**：格式为 `provider/modelId`（例如：`IMOHUAN/deepseek-v4-pro`）

### 1.3 重要说明
根据实际配置文件调查，**OpenCode 需要同步模型配置**。虽然可以通过 opencodex 代理，但 OpenCode 自己也有独立的 provider 和 models 配置结构，需要完整同步。

### 1.3 支持平台

| 平台 | 配置路径 | 格式 | 同步内容 | 备注 |
|------|---------|------|---------|------|
| OpenCode | `~/.config/opencode/opencode.json` | JSON | 模型 + MCP | 需要完整同步 |
| Codex | `~/.codex/config.toml` | TOML | 仅 MCP | opencodex 已支持模型 |
| Claude Code | `~/.claude.json` | JSON | 仅 MCP | opencodex 已支持模型 |
| Reasonix | `%APPDATA%/reasonix/config.toml` | TOML | 模型 + MCP | 需要完整同步 |
| PenguinHarness | 待调查 | 待调查 | 模型 + MCP | 需要完整同步 |

---

## 二、配置文件调查结果

### 2.1 源配置：.opencodex/config.json

```json
{
  "port": 10100,
  "providers": {
    "IMOHUAN": {
      "adapter": "openai-chat",
      "baseUrl": "https://newapi.imohuan.shop/v1",
      "apiKey": "sk-xxx",
      "defaultModel": "deepseek-v4-pro",
      "apiKeyPool": [...]
    }
  },
  "customModels": [
    {
      "id": "uuid",
      "provider": "IMOHUAN",
      "modelId": "deepseek-v4-flash",
      "displayName": "c-deepseek-v4-flash",
      "contextWindow": 1000000,
      "inputModalities": ["text", "image"]
    }
  ]
}
```

**关键字段**：
- `providers`: provider 配置（baseUrl, apiKey, adapter）
- `customModels`: 自定义模型元数据（contextWindow, inputModalities 等）

### 2.2 目标平台 1：OpenCode

**路径**：`~/.config/opencode/opencode.json`
**格式**：JSON
**Variants 支持**：是（完整支持 reasoningEffort 和 thinking 配置）
**结构**：
```json
{
  "mcp": {
    "codegraph": {
      "type": "local",
      "enabled": true,
      "command": ["codegraph", "serve", "--mcp"]
    },
    "baizhi_juhe": {
      "type": "remote",
      "enabled": true,
      "url": "https://...",
      "headers": {
        "Authorization": "Bearer xxx"
      }
    }
  },
  "provider": {
    "newapi-openai": {
      "name": "newapi",
      "npm": "@ai-sdk/openai",
      "options": {
        "baseURL": "https://...",
        "apiKey": "sk-xxx"
      },
      "models": {
        "gpt-5.6-luna": {
          "name": "gpt-5.6-luna",
          "limit": {
            "context": 1050000,
            "output": 128000
          },
          "modalities": {
            "input": ["text", "image"],
            "output": ["text"]
          },
          "reasoning": true,
          "tool_call": true
        }
      }
    }
  }
}
```

**关键发现**：
- MCP 配置在 `mcp` 对象下，**不是** `mcp.servers`
- 每个 MCP 服务器直接是 `mcp` 的子对象
- 本地服务器：`type: "local"`, `command: [...]`
- 远程服务器：`type: "remote"`, `url`, `headers`
- 模型配置非常复杂，包含 reasoning、variants 等

### 2.3 目标平台 2：Codex

**路径**：`~/.codex/config.toml`
**格式**：TOML
**Reasoning 支持**：是（全局 `model_reasoning_effort` 配置：`low|medium|high|xhigh|max|ultra`）
**结构**：
```toml
model = "IMOHUAN/deepseek-v4-pro"
openai_base_url = "http://127.0.0.1:10100/v1"

[mcp_servers.codegraph]
command = "codegraph"
args = ["serve", "--mcp", "--path", "${workspaceFolder}"]
enabled = true

[mcp_servers.baizhi_juhe]
url = "https://..."
enabled = true

[mcp_servers.baizhi_juhe.headers]
Authorization = "Bearer xxx"
```

**关键发现**：
- MCP 配置在 `[mcp_servers.xxx]` 表下
- 本地服务器：`command` + `args`
- 远程服务器：`url` + `headers` 子表
- 模型通过 opencodex 代理，不需要同步

### 2.4 目标平台 3：Claude Code

**路径**：`~/.claude.json`
**格式**：JSON
**结构**（需要进一步调查）：
```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "package"],
      "env": {}
    }
  }
}
```

### 2.5 目标平台 4：Reasonix

**路径**：`%APPDATA%/reasonix/config.toml`
**格式**：TOML
**Reasoning 支持**：是（支持 reasoning effort，但配置在全局或运行时指定）
**结构**：
```toml
default_model = "newapi/deepseek-v4-pro"

[[providers]]
name = "newapi"
kind = "openai"
base_url = "https://newapi.imohuan.shop/v1"
models = ["deepseek-v4-pro", "claude-opus-5", ...]
default = "deepseek-v4-pro"
api_key_env = "NEWAPI_API_KEY"
vision_models = ["deepseek-v4-pro", ...]

# MCP 配置（需要进一步调查）
```

**关键发现**：
- 使用 `[[providers]]` 数组定义多个 provider
- 模型列表是字符串数组
- API Key 通过环境变量引用（`api_key_env`）
- 需要同步模型配置

### 2.6 目标平台 5：PenguinHarness

**路径**：待调查（可能在 `~/.penguin` 或 `%APPDATA%/PenguinHarness`）
**格式**：待调查
**当前发现**：只有一个 `data/` 目录和 `web.db` 数据库文件

---

## 三、系统架构

### 3.1 目录结构

```
ai-sync/
├── src/
│   ├── core/
│   │   ├── config-loader.mjs        # 加载 .opencodex/config.json
│   │   ├── metadata-fetcher.mjs     # 获取模型元数据
│   │   ├── model-matcher.mjs        # 模型名称模糊匹配
│   │   └── toml-stable.mjs          # TOML 稳定编辑器
│   ├── adapters/
│   │   ├── base-adapter.mjs         # 适配器基类
│   │   ├── opencode.mjs             # OpenCode 适配器（仅 MCP）
│   │   ├── codex.mjs                # Codex 适配器（仅 MCP）
│   │   ├── claude-code.mjs          # Claude Code 适配器（仅 MCP）
│   │   ├── reasonix.mjs             # Reasonix 适配器（模型 + MCP）
│   │   └── penguin.mjs              # PenguinHarness 适配器（模型 + MCP）
│   ├── utils/
│   │   ├── logger.mjs               # 日志工具
│   │   ├── file-utils.mjs           # 文件操作
│   │   └── path-resolver.mjs        # 路径解析
│   └── cli.mjs                      # CLI 主入口
├── config/
│   ├── known-models.json            # 已知模型静态配置
│   └── platform-configs.json        # 各平台配置路径
├── test/
│   └── fixtures/                    # 测试数据
├── package.json
├── DESIGN.md                        # 本设计文档
└── README.md
```

### 3.2 数据流程

```
1. 加载源配置
   .opencodex/config.json
   → ConfigLoader.load()
   → { providers, customModels, ... }

2. 增强模型元数据
   models
   → MetadataFetcher.enrich()
   → [静态表, OpenRouter API, 默认值]
   → enrichedModels (带完整元数据)

3. 适配器转换和写入
   { enrichedModels, mcpServers }
   → Adapter.sync()
   → 平台特定格式
   → 写入目标配置文件
```

---

## 四、核心模块设计

### 4.1 配置加载器 (config-loader.mjs)

**功能**：
- 读取 `.opencodex/config.json`
- 解析 providers 和 customModels
- 提取 MCP 配置（如果有）
- 输出标准化的配置对象

**接口**：
```javascript
export class ConfigLoader {
  /**
   * 加载 opencodex 配置
   * @param {string} configPath - 配置文件路径
   * @returns {Promise<{providers, models, mcp}>}
   */
  static async load(configPath) {
    // 读取并解析 JSON
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // 提取 providers
    const providers = config.providers || {};
    
    // 提取 customModels
    const customModels = config.customModels || [];
    
    // 构建模型列表
    const models = [];
    for (const [providerName, providerConfig] of Object.entries(providers)) {
      // 从 customModels 中找到属于该 provider 的模型
      const providerModels = customModels.filter(m => m.provider === providerName);
      
      for (const model of providerModels) {
        models.push({
          provider: providerName,
          providerConfig: providerConfig,
          modelId: model.modelId,
          displayName: model.displayName || `${providerName}/${model.modelId}`,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.outputLimit,
          supportsVision: model.inputModalities?.includes('image'),
          supportsThinking: false, // 需要从其他地方获取
          ...model
        });
      }
    }
    
    // 提取 MCP 配置（如果有）
    const mcp = config.mcp || {};
    
    return { providers, models, mcp };
  }
}
```

### 4.2 元数据获取器 (metadata-fetcher.mjs)

**功能**：
- 从静态 known-models.json 获取元数据
- 从 OpenRouter API 获取在线元数据
- 模糊匹配模型名称
- 降级到默认值

**接口**：
```javascript
export class MetadataFetcher {
  /**
   * 增强模型元数据
   * @param {Array} models - 模型列表
   * @returns {Promise<Array>} 增强后的模型列表
   */
  static async enrich(models) {
    const knownModels = this.loadKnownModels();
    const orIndex = await this.fetchOpenRouterIndex();
    
    for (const model of models) {
      // 优先使用已有的元数据
      if (model.contextWindow && model.maxOutputTokens) {
        continue;
      }
      
      // 查找元数据
      const metadata = 
        this.findInKnownModels(model.modelId, knownModels) ||
        this.findInOpenRouter(model.modelId, orIndex) ||
        this.getDefaultMetadata();
      
      // 合并元数据
      Object.assign(model, {
        contextWindow: model.contextWindow || metadata.context,
        maxOutputTokens: model.maxOutputTokens || metadata.output,
        supportsVision: model.supportsVision ?? metadata.vision,
        supportsThinking: model.supportsThinking ?? metadata.thinking
      });
    }
    
    return models;
  }
  
  /**
   * 从 OpenRouter 获取模型索引
   */
  static async fetchOpenRouterIndex() {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models');
      const data = await response.json();
      
      const index = {};
      for (const model of data.data || []) {
        const id = model.id.split('/').pop();
        index[id] = {
          context: model.context_length,
          output: model.top_provider?.max_completion_tokens,
          vision: model.architecture?.modality === 'multimodal'
        };
      }
      return index;
    } catch (e) {
      console.warn('OpenRouter 索引获取失败:', e.message);
      return {};
    }
  }
  
  /**
   * 模糊匹配模型名称
   */
  static findInKnownModels(modelId, knownModels) {
    // 精确匹配
    if (knownModels[modelId]) {
      return knownModels[modelId];
    }
    
    // 标准化名称（去除特殊字符）
    const norm = modelId.toLowerCase().replace(/[-_.:]/g, '');
    
    for (const [key, metadata] of Object.entries(knownModels)) {
      const keyNorm = key.toLowerCase().replace(/[-_.:]/g, '');
      if (norm === keyNorm || norm.includes(keyNorm) || keyNorm.includes(norm)) {
        return metadata;
      }
    }
    
    return null;
  }
}
```

### 4.3 TOML 稳定编辑器 (toml-stable.mjs)

**功能**：
- 复用 `D:\Code\Learn\codex-base-ui\mcps\utils\codex-toml.mjs`
- 保持 TOML 格式稳定
- 只修改需要的字段

**接口**：
```javascript
export { tomlToJson, jsonToToml } from './codex-toml.mjs';
```

### 4.4 适配器基类 (base-adapter.mjs)

**接口**：
```javascript
export class BaseAdapter {
  constructor(platformName) {
    this.platformName = platformName;
  }
  
  /**
   * 获取配置文件路径
   * @returns {string}
   */
  getConfigPath() {
    throw new Error('Must implement getConfigPath()');
  }
  
  /**
   * 同步模型配置
   * @param {Array} models - 增强后的模型列表
   */
  async syncModels(models) {
    throw new Error('Must implement syncModels()');
  }
  
  /**
   * 同步 MCP 配置
   * @param {Object} mcpServers - MCP 服务器配置
   */
  async syncMcp(mcpServers) {
    throw new Error('Must implement syncMcp()');
  }
  
  /**
   * 执行完整同步
   */
  async sync(config) {
    const { models, mcp } = config;
    
    // 备份
    await this.backup();
    
    // 同步
    if (this.supportsModels) {
      await this.syncModels(models);
    }
    
    if (this.supportsMcp) {
      await this.syncMcp(mcp);
    }
  }
  
  /**
   * 备份配置文件
   */
  async backup() {
    const configPath = this.getConfigPath();
    if (!fs.existsSync(configPath)) return;
    
    const backupPath = `${configPath}.bak-${Date.now()}`;
    fs.copyFileSync(configPath, backupPath);
    console.log(`Backup: ${backupPath}`);
  }
}
```

---

## 五、适配器实现

### 5.1 OpenCode 适配器（模型 + MCP）

```javascript
export class OpenCodeAdapter extends BaseAdapter {
  supportsModels = true;
  supportsMcp = true;
  
  getConfigPath() {
    return path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  }
  
  async syncModels(models) {
    const configPath = this.getConfigPath();
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // 确保 provider 对象存在
    if (!config.provider) config.provider = {};
    
    // 按 provider 分组
    const providerGroups = {};
    for (const model of models) {
      if (!providerGroups[model.provider]) {
        providerGroups[model.provider] = {
          models: {},
          config: model.providerConfig
        };
      }
      
      // 构建模型配置
      providerGroups[model.provider].models[model.modelId] = {
        name: model.modelId,
        limit: {
          context: model.contextWindow,
          output: model.maxOutputTokens
        },
        modalities: {
          input: model.inputModalities || ['text'],
          output: ['text']
        },
        reasoning: model.supportsThinking || false,
        tool_call: model.supportsFunctionCalling !== false
      };
    }
    
    // 更新 provider 配置
    for (const [providerName, group] of Object.entries(providerGroups)) {
      const adapter = group.config.adapter; // openai-chat, anthropic, deepseek 等
      let npm = '@ai-sdk/openai';
      
      // 根据 adapter 确定 npm 包
      if (adapter === 'anthropic' || adapter === 'anthropic-chat') {
        npm = '@ai-sdk/anthropic';
      } else if (adapter === 'deepseek' || adapter === 'deepseek-chat') {
        npm = '@ai-sdk/deepseek';
      } else if (adapter === 'openai-compatible') {
        npm = '@ai-sdk/openai-compatible';
      }
      
      const providerKey = `${providerName.toLowerCase()}-${npm.split('/')[1]}`;
      
      config.provider[providerKey] = {
        name: providerName.toLowerCase(),
        npm: npm,
        options: {
          baseURL: group.config.baseUrl,
          apiKey: group.config.apiKey
        },
        models: group.models
      };
    }
    
    // 写入
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
  
  async syncMcp(mcpServers) {
    const configPath = this.getConfigPath();
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // 确保 mcp 对象存在
    if (!config.mcp) config.mcp = {};
    
    // 转换 MCP 配置
    for (const [name, server] of Object.entries(mcpServers)) {
      const isRemote = !!server.url;
      
      config.mcp[name] = {
        type: isRemote ? 'remote' : 'local',
        enabled: server.enabled !== false,
        ...(isRemote ? {
          url: server.url,
          headers: server.bearerToken ? {
            Authorization: `Bearer ${server.bearerToken}`
          } : {}
        } : {
          command: [server.command, ...(server.args || [])]
        })
      };
    }
    
    // 写入
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
}
```

### 5.2 Codex 适配器（仅 MCP）

```javascript
export class CodexAdapter extends BaseAdapter {
  supportsModels = false; // opencodex 已支持
  supportsMcp = true;
  
  getConfigPath() {
    return path.join(os.homedir(), '.codex', 'config.toml');
  }
  
  async syncMcp(mcpServers) {
    const configPath = this.getConfigPath();
    const raw = fs.readFileSync(configPath, 'utf-8');
    
    // TOML → JSON
    const config = tomlToJson(raw);
    
    // 确保 mcp_servers 存在
    if (!config.mcp_servers) config.mcp_servers = {};
    
    // 转换 MCP 配置
    for (const [name, server] of Object.entries(mcpServers)) {
      const isRemote = !!server.url;
      
      if (isRemote) {
        config.mcp_servers[name] = {
          url: server.url,
          enabled: server.enabled !== false
        };
        
        if (server.bearerToken) {
          config.mcp_servers[name].headers = {
            Authorization: `Bearer ${server.bearerToken}`
          };
        }
      } else {
        config.mcp_servers[name] = {
          command: server.command,
          args: server.args || [],
          enabled: server.enabled !== false
        };
      }
    }
    
    // JSON → TOML
    const toml = jsonToToml(config);
    fs.writeFileSync(configPath, toml);
  }
}
```

### 5.3 Reasonix 适配器（模型 + MCP）

```javascript
export class ReasonixAdapter extends BaseAdapter {
  supportsModels = true;
  supportsMcp = true;
  
  getConfigPath() {
    return path.join(process.env.APPDATA, 'reasonix', 'config.toml');
  }
  
  async syncModels(models) {
    const configPath = this.getConfigPath();
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = tomlToJson(raw);
    
    // 按 provider 分组
    const providerGroups = {};
    for (const model of models) {
      if (!providerGroups[model.provider]) {
        providerGroups[model.provider] = {
          models: [],
          visionModels: [],
          config: model.providerConfig
        };
      }
      
      providerGroups[model.provider].models.push(model.modelId);
      if (model.supportsVision) {
        providerGroups[model.provider].visionModels.push(model.modelId);
      }
    }
    
    // 更新 providers
    if (!config.providers) config.providers = [];
    
    for (const [providerName, group] of Object.entries(providerGroups)) {
      // 查找已有 provider
      let provider = config.providers.find(p => p.name === providerName);
      
      if (!provider) {
        provider = {
          name: providerName,
          kind: 'openai',
          base_url: group.config.baseUrl,
          api_key_env: `${providerName.toUpperCase()}_API_KEY`
        };
        config.providers.push(provider);
      }
      
      // 更新模型列表
      provider.models = group.models;
      provider.vision_models = group.visionModels;
      provider.default = group.config.defaultModel;
    }
    
    // 写入
    const toml = jsonToToml(config);
    fs.writeFileSync(configPath, toml);
  }
  
  async syncMcp(mcpServers) {
    // Reasonix MCP 配置格式待调查
  }
}
```

---

## 六、CLI 设计

### 6.1 命令行参数

```bash
# 同步到所有平台
node cli.mjs --all

# 同步到指定平台
node cli.mjs --platforms opencode,reasonix,codex

# 仅同步模型
node cli.mjs --models-only --platforms reasonix

# 仅同步 MCP
node cli.mjs --mcp-only

# 预览模式（不实际写入）
node cli.mjs --dry-run

# 更新元数据缓存
node cli.mjs --update-metadata

# 列出支持的平台
node cli.mjs --list-platforms

# 指定源配置文件
node cli.mjs --source ~/.opencodex/config.json
```

### 6.2 CLI 入口 (cli.mjs)

```javascript
import { Command } from 'commander';
import { ConfigLoader } from './core/config-loader.mjs';
import { MetadataFetcher } from './core/metadata-fetcher.mjs';
import { OpenCodeAdapter } from './adapters/opencode.mjs';
import { CodexAdapter } from './adapters/codex.mjs';
import { ReasonixAdapter } from './adapters/reasonix.mjs';

const ADAPTERS = {
  opencode: OpenCodeAdapter,
  codex: CodexAdapter,
  claudecode: ClaudeCodeAdapter,
  reasonix: ReasonixAdapter,
  penguin: PenguinAdapter
};

const program = new Command();

program
  .name('ai-sync')
  .description('同步 AI 配置到多个平台')
  .version('1.0.0');

program
  .option('--all', '同步到所有平台')
  .option('--platforms <list>', '指定平台（逗号分隔）', 'opencode,codex,claudecode,reasonix')
  .option('--models-only', '仅同步模型配置')
  .option('--mcp-only', '仅同步 MCP 配置')
  .option('--dry-run', '预览模式，不实际写入')
  .option('--source <path>', '源配置文件路径', path.join(os.homedir(), '.opencodex', 'config.json'))
  .option('--list-platforms', '列出支持的平台')
  .option('--update-metadata', '更新元数据缓存')
  .action(async (options) => {
    if (options.listPlatforms) {
      console.log('支持的平台:');
      for (const [name, Adapter] of Object.entries(ADAPTERS)) {
        const adapter = new Adapter(name);
        console.log(`  - ${name}: 模型=${adapter.supportsModels}, MCP=${adapter.supportsMcp}`);
      }
      return;
    }
    
    // 加载源配置
    console.log(`加载配置: ${options.source}`);
    const config = await ConfigLoader.load(options.source);
    
    // 增强元数据
    console.log('增强模型元数据...');
    config.models = await MetadataFetcher.enrich(config.models);
    
    // 选择平台
    const platforms = options.all 
      ? Object.keys(ADAPTERS)
      : options.platforms.split(',').map(p => p.trim());
    
    // 同步到各平台
    for (const platformName of platforms) {
      const AdapterClass = ADAPTERS[platformName];
      if (!AdapterClass) {
        console.warn(`未知平台: ${platformName}`);
        continue;
      }
      
      const adapter = new AdapterClass(platformName);
      
      console.log(`\n同步到 ${platformName}...`);
      
      if (options.dryRun) {
        console.log('  [预览模式] 跳过实际写入');
        continue;
      }
      
      try {
        await adapter.sync({
          models: options.mcpOnly ? [] : config.models,
          mcp: options.modelsOnly ? {} : config.mcp
        });
        console.log(`  ✓ ${platformName} 同步完成`);
      } catch (error) {
        console.error(`  ✗ ${platformName} 同步失败:`, error.message);
      }
    }
  });

program.parse();
```

---

## 七、实现计划

### Phase 1: 核心基础（优先级：高）
- [x] 调查各平台配置格式
- [ ] 实现 ConfigLoader
- [ ] 实现 MetadataFetcher
- [ ] 复用 TOML 稳定编辑器
- [ ] 实现 BaseAdapter

### Phase 2: 完整同步平台（优先级：高）
- [ ] 实现 OpenCode 模型同步
- [ ] 实现 OpenCode MCP 同步
- [ ] 实现 Reasonix 模型同步
- [ ] 实现 Reasonix MCP 同步

### Phase 3: MCP 同步平台（优先级：中）
- [ ] 实现 Codex MCP 同步
- [ ] 实现 Claude Code MCP 同步
- [ ] 调查 PenguinHarness 配置格式
- [ ] 实现 PenguinHarness 适配器

### Phase 4: CLI 和测试（优先级：中）
- [ ] 实现 CLI 入口
- [ ] 添加日志和错误处理
- [ ] 编写单元测试
- [ ] 编写集成测试

### Phase 5: 文档和发布（优先级：低）
- [ ] 编写 README
- [ ] 添加使用示例
- [ ] 发布到 npm

---

## 八、待调查问题

1. **PenguinHarness 配置格式**：
   - 配置文件路径
   - 模型配置格式
   - MCP 配置格式

2. **Claude Code MCP 格式**：
   - 需要查看 `~/.claude.json` 的完整结构
   - MCP 配置是否在 `mcpServers` 下

3. **Reasonix MCP 格式**：
   - `config.toml` 中是否有 MCP 配置项
   - 如果有，格式是什么

4. **环境变量处理**：
   - Reasonix 使用 `api_key_env` 引用环境变量
   - 需要创建 `.env` 文件或设置系统环境变量

5. **模型显示名称规则**：
   - 确认 `provider/modelId` 格式是否适用于所有平台
   - 是否需要考虑 displayName 字段

---

## 九、注意事项

1. **不要覆盖现有配置**：同步时保留目标平台的其他配置项
2. **备份机制**：每次同步前自动备份配置文件
3. **错误处理**：单个平台失败不影响其他平台
4. **日志输出**：清晰的进度和错误信息
5. **权限处理**：确保有写入配置文件的权限
6. **路径兼容**：支持 Windows 和 Unix 路径
7. **格式稳定**：使用稳定的 TOML/JSON 编辑器，保留注释和格式

---

## 十、参考资料

- opencodex: https://github.com/lidge-jun/opencodex
- codex-base-ui MCP 工具: D:\Code\Learn\codex-base-ui\mcps
- OpenRouter API: https://openrouter.ai/api/v1/models
- monkeycode 批量导入脚本: D:\Code\Learn\Monkey-web-js\monkeycode-batch-import.user.js
