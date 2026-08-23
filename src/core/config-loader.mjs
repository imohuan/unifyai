#!/usr/bin/env node

/**
 * config-loader.mjs
 * 加载 .opencodex/config.json 配置并从每个 provider 获取模型列表
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class ConfigLoader {
  /**
   * 加载 opencodex 配置
   * @param {string} [configPath] - 配置文件路径
   * @returns {Promise<{providers: Object, models: Array, mcp: Object}>}
   */
  static async load(configPath) {
    // 默认路径
    if (!configPath) {
      configPath = path.join(os.homedir(), '.opencodex', 'config.json');
    }

    // 检查文件是否存在
    if (!fs.existsSync(configPath)) {
      throw new Error(`配置文件不存在: ${configPath}`);
    }

    // 读取并解析 JSON
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    // 提取 providers
    const providers = config.providers || {};

    // disabledModels: 需要过滤掉的模型（裸名，如 "gpt-5.5"）
    // 匹配时按 providers[key] + "/" + 模型名 比较，例如 "IMOHUAN/deepseek-v4-flash"
    const disabledModels = Array.isArray(config.disabledModels) ? config.disabledModels : [];

    console.log(`✓ 加载配置: ${Object.keys(providers).length} 个 provider`);

    // 优先尝试从 opencodex 代理服务获取统一模型列表
    const port = config.port || 10100;
    const proxyUrl = `http://localhost:${port}/v1/models`;

    // 从 opencodex 配置中读取客户端 API key（config.apiKeys），请求代理时携带
    // 参考: https://github.com/lidge-jun/opencodex —— 代理自身鉴权使用 x-opencodex-api-key 请求头
    // 本机 127.0.0.1 模式免认证；绑定 0.0.0.0 / 设置 OPENCODEX_API_AUTH_TOKEN 后必须携带。
    let proxyApiKey = null;
    if (Array.isArray(config.apiKeys) && config.apiKeys.length > 0) {
      proxyApiKey = config.apiKeys[0].key || null;
    } else if (process.env.OPENCODEX_API_AUTH_TOKEN) {
      proxyApiKey = process.env.OPENCODEX_API_AUTH_TOKEN;
    }
    if (proxyApiKey) {
      console.log(`✓ 已携带 OpenCodex 代理 API key (${proxyApiKey.slice(0, 12)}...)`);
    }

    let models = [];
    const proxyResult = await this.tryFetchFromProxy(proxyUrl, providers, proxyApiKey);
    
    if (proxyResult.success) {
      console.log(`\n✓ 从 OpenCodex 代理服务获取模型列表 (http://localhost:${port})`);
      console.log(`  ✓ 获取到 ${proxyResult.models.length} 个模型\n`);
      models = proxyResult.models;
      // 代理返回的模型同样过滤：disabled provider + disabledModels
      const enabledProviderNames = new Set(
        Object.entries(providers).filter(([, cfg]) => !cfg.disabled).map(([n]) => n)
      );
      const beforeFilter = models.length;
      models = models.filter(m => enabledProviderNames.has(m.provider));
      models = this.filterDisabledModels(models, disabledModels);
      const removed = beforeFilter - models.length;
      if (removed > 0) {
        console.log(`  ⊘ 过滤 disabled provider / disabledModels: ${removed} 个模型`);
      }
    } else {
      console.log(`\n⚠ OpenCodex 代理服务不可用，降级到逐个 provider 获取`);
      
      // 降级：逐个 provider 获取（跳过 disabled 的 provider）
      const enabledProviders = Object.entries(providers).filter(
        ([name, cfg]) => !cfg.disabled
      );
      const skippedDisabled = Object.keys(providers).length - enabledProviders.length;
      if (skippedDisabled > 0) {
        console.log(`  ⊘ 跳过 ${skippedDisabled} 个 disabled provider: ${enabledProviders.map(([n]) => n).join(', ') || '(无)'}`);
      }

      for (const [providerName, providerConfig] of enabledProviders) {
        console.log(`\n📡 获取 ${providerName} 的模型列表...`);
        
        const providerModels = await this.fetchProviderModels(providerName, providerConfig);
        
        if (providerModels.length > 0) {
          // 过滤该 provider 下 disabledModels 中的模型
          const filtered = this.filterDisabledModels(providerModels, disabledModels);
          const removed = providerModels.length - filtered.length;
          if (removed > 0) {
            console.log(`  ⊘ 过滤 disabledModels: ${removed} 个模型`);
          }
          console.log(`  ✓ 获取到 ${filtered.length} 个模型`);
          models.push(...filtered);
        } else {
          console.warn(`  ⚠ ${providerName} 没有返回模型`);
        }
      }
    }

    // 从项目的 mcp.json 加载 MCP 配置
    const mcp = await this.loadMcpConfig();

    console.log(`\n✓ 总计: ${models.length} 个模型来自 ${Object.keys(providers).length} 个 provider`);

    return {
      providers,
      models,
      mcp,
      _raw: config
    };
  }

  /**
   * 加载 MCP 配置
   * 优先从 cwd/mcp.json 读取，回退到 ~/.unifyai/mcp.json
   * @returns {Promise<Object>} MCP 配置对象
   */
  static async loadMcpConfig() {
    // 优先级 1: 当前工作目录
    const cwdPath = path.join(process.cwd(), 'mcp.json');
    // 优先级 2: 用户配置目录
    const userPath = path.join(os.homedir(), '.unifyai', 'mcp.json');
    
    let mcpPath = null;
    let source = null;
    
    if (fs.existsSync(cwdPath)) {
      mcpPath = cwdPath;
      source = 'cwd';
    } else if (fs.existsSync(userPath)) {
      mcpPath = userPath;
      source = '~/.unifyai';
    } else {
      console.log('⚠ mcp.json 不存在（已尝试 cwd 和 ~/.unifyai），跳过 MCP 同步');
      return {};
    }
    
    try {
      const content = fs.readFileSync(mcpPath, 'utf-8');
      const mcpConfig = JSON.parse(content);
      
      // 验证 mcpServers 字段
      if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== 'object') {
        console.warn(`⚠ ${mcpPath} 格式错误：缺少 mcpServers 字段`);
        return {};
      }

      // 过滤掉 disabled 的服务器
      const enabledServers = {};
      for (const [name, config] of Object.entries(mcpConfig.mcpServers)) {
        if (!config.disabled) {
          enabledServers[name] = config;
        }
      }

      const total = Object.keys(mcpConfig.mcpServers).length;
      const enabled = Object.keys(enabledServers).length;
      
      console.log(`\n✓ MCP 配置 (来自 ${source}): ${enabled}/${total} 个服务器启用`);
      
      return { mcpServers: enabledServers };
    } catch (error) {
      console.warn(`⚠ 加载 ${mcpPath} 失败: ${error.message}`);
      return {};
    }
  }

  /**
   * 尝试从 OpenCodex 代理服务获取统一模型列表
   * @param {string} proxyUrl - 代理服务的 /v1/models URL
   * @param {Object} providers - provider 配置对象
   * @param {string|null} apiKey - OpenCodex 代理自身的 API key（来自 config.apiKeys 或 OPENCODEX_API_AUTH_TOKEN）
   * @returns {Promise<{success: boolean, models: Array}>}
   */
  static async tryFetchFromProxy(proxyUrl, providers, apiKey = null) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3秒超时

      const headers = {
        'Content-Type': 'application/json'
      };

      // OpenCodex 代理鉴权: 绑定非 loopback 或设置 OPENCODEX_API_AUTH_TOKEN 后,
      // 每个客户端请求都必须携带 x-opencodex-api-key 头。
      // 参考: https://github.com/lidge-jun/opencodex
      if (apiKey) {
        headers['x-opencodex-api-key'] = apiKey;
        // 兼容 OpenAI 风格的 Bearer 鉴权
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(proxyUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`  ⚠ OpenCodex 代理返回异常状态: HTTP ${response.status} ${response.statusText}`);
        return { success: false, models: [] };
      }

      const data = await response.json();
      
      if (!data.data || !Array.isArray(data.data)) {
        return { success: false, models: [] };
      }

      // 解析模型列表，推断 provider
      const models = [];
      for (const m of data.data) {
        // 模型 ID 格式可能是:
        // 1. "PROVIDER/model-id" (例如: "IMOHUAN/deepseek-v4-pro")
        // 2. "PROVIDER/org/model-id" (例如: "IMOHUAN/deepseek-ai/DeepSeek-V4-Pro")
        // 3. "model-id" (例如: "deepseek-v4-pro")
        
        let providerName = null;
        let modelId = m.id;

        // 检查是否以已知 provider 名称开头
        for (const name of Object.keys(providers)) {
          if (m.id.startsWith(name + '/')) {
            providerName = name;
            // 去掉 "PROVIDER/" 前缀，保留后面的部分
            modelId = m.id.substring(name.length + 1);
            break;
          }
        }

        // 如果没有匹配到 provider 前缀
        if (!providerName) {
          // 尝试匹配到某个 provider 的 defaultModel
          for (const [name, config] of Object.entries(providers)) {
            if (config.defaultModel === m.id) {
              providerName = name;
              break;
            }
          }
          
          // 如果还是找不到，使用第一个 provider
          if (!providerName) {
            providerName = Object.keys(providers)[0];
          }
        }

        const providerConfig = providers[providerName];
        if (!providerConfig) {
          // 跳过无法识别的 provider
          continue;
        }

        models.push({
          provider: providerName,
          providerConfig: providerConfig,
          modelId: modelId,
          displayName: `${providerName}/${modelId}`,
          contextWindow: m.context_length || null,
          maxOutputTokens: m.max_tokens || null,
          supportsVision: null, // 由 metadata-fetcher 从 OpenRouter 获取
          supportsThinking: null, // 由 metadata-fetcher 从 OpenRouter 获取
          supportsFunctionCalling: true,
          inputModalities: ['text'],
          _raw: m,
          _source: 'opencodex-proxy'
        });
      }

      return { success: true, models };
    } catch (error) {
      // 失败原因分类（方便用户诊断"为什么代理不可用"）
      const name = error?.name || '';
      const causeCode = error?.cause?.code || '';
      let reason = error?.message || String(error);
      if (name === 'AbortError' || reason.includes('abort')) {
        reason = `请求超时（3s 内代理未响应 ${proxyUrl}）`;
      } else if (causeCode === 'ECONNREFUSED' || reason.includes('ECONNREFUSED')) {
        reason = `连接被拒绝：${proxyUrl} 没有服务在监听（代理进程未启动？）`;
      } else if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN' || reason.includes('ENOTFOUND')) {
        reason = `DNS 解析失败：${proxyUrl}`;
      }
      console.warn(`  ⚠ OpenCodex 代理请求失败: ${name}${causeCode ? ' [' + causeCode + ']' : ''}: ${reason}`);
      return { success: false, models: [] };
    }
  }

  /**
   * 过滤 disabledModels 中的模型
   * disabledModels 存的是裸名（如 "gpt-5.5"），匹配时按
   * providers[key] + "/" + 模型名 比较，例如 "IMOHUAN/deepseek-v4-flash"
   * @param {Array} models - 统一格式的模型列表
   * @param {Array} disabledModels - 裸名数组
   * @returns {Array}
   */
  static filterDisabledModels(models, disabledModels) {
    if (!Array.isArray(disabledModels) || disabledModels.length === 0) return models;
    // 构造匹配集合（裸名）
    const disabledSet = new Set(disabledModels);
    return models.filter(m => {
      // 裸名直接命中（如 gpt-5.5）
      if (disabledSet.has(m.modelId)) return false;
      // provider/模型名 命中（如 IMOHUAN/deepseek-v4-flash）
      if (disabledSet.has(`${m.provider}/${m.modelId}`)) return false;
      return true;
    });
  }

  /**
   * 从 provider 的 /v1/models 接口获取模型列表
   * @param {string} providerName
   * @param {Object} providerConfig
   * @returns {Promise<Array>}
   */
  static async fetchProviderModels(providerName, providerConfig) {
    const baseUrl = providerConfig.baseUrl;
    const apiKey = providerConfig.apiKey;

    if (!baseUrl || !apiKey) {
      console.warn(`  ⚠ ${providerName} 缺少 baseUrl 或 apiKey`);
      return [];
    }

    // 构建 API URL
    const url = `${baseUrl}/models`;

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn(`  ⚠ API 请求失败: HTTP ${response.status}`);
        return [];
      }

      const data = await response.json();
      const modelsList = data.data || [];

      // 转换为统一格式
      const models = modelsList.map(m => ({
        provider: providerName,
        providerConfig: providerConfig,
        modelId: m.id,
        displayName: `${providerName}/${m.id}`,
        // 从 API 返回的数据中提取（如果有）
        contextWindow: m.context_length || null,
        maxOutputTokens: m.max_tokens || null,
        supportsVision: null, // 由 metadata-fetcher 从 OpenRouter 获取
        supportsThinking: null, // 由 metadata-fetcher 从 OpenRouter 获取
        supportsFunctionCalling: true,
        inputModalities: ['text'],
        // 保留原始数据
        _raw: m
      }));

      return models;

    } catch (error) {
      console.warn(`  ⚠ 获取失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 从统一格式转换 MCP 服务器配置
   * @param {Object} mcpConfig - opencodex 的 MCP 配置
   * @returns {Object} 统一格式的 MCP 服务器配置
   */
  static normalizeMcp(mcpConfig) {
    const servers = {};

    for (const [name, server] of Object.entries(mcpConfig)) {
      const isRemote = server.type === 'remote' || !!server.url;

      servers[name] = {
        name,
        enabled: server.enabled !== false,
        transport: isRemote ? (server.transport || 'streamable-http') : 'stdio',
        // 本地服务器
        command: isRemote ? null : (Array.isArray(server.command) ? server.command[0] : server.command),
        args: isRemote ? null : (Array.isArray(server.command) ? server.command.slice(1) : (server.args || [])),
        // 远程服务器
        url: server.url || null,
        bearerToken: this.extractBearerToken(server.headers),
        env: server.environment || server.env || {},
        // 原始数据
        _raw: server
      };
    }

    return servers;
  }

  /**
   * 从 headers 中提取 Bearer token
   * @param {Object} headers
   * @returns {string|null}
   */
  static extractBearerToken(headers) {
    if (!headers || typeof headers !== 'object') return null;

    const auth = headers.Authorization || headers.authorization || '';
    const match = auth.match(/Bearer\s+(.+)/);
    return match ? match[1] : null;
  }
}
