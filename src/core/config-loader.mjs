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

    console.log(`✓ 加载配置: ${Object.keys(providers).length} 个 provider`);

    // 优先尝试从 opencodex 代理服务获取统一模型列表
    const port = config.port || 10100;
    const proxyUrl = `http://localhost:${port}/v1/models`;
    
    let models = [];
    const proxyResult = await this.tryFetchFromProxy(proxyUrl, providers);
    
    if (proxyResult.success) {
      console.log(`\n✓ 从 OpenCodex 代理服务获取模型列表 (http://localhost:${port})`);
      console.log(`  ✓ 获取到 ${proxyResult.models.length} 个模型\n`);
      models = proxyResult.models;
    } else {
      console.log(`\n⚠ OpenCodex 代理服务不可用，降级到逐个 provider 获取`);
      
      // 降级：逐个 provider 获取
      for (const [providerName, providerConfig] of Object.entries(providers)) {
        console.log(`\n📡 获取 ${providerName} 的模型列表...`);
        
        const providerModels = await this.fetchProviderModels(providerName, providerConfig);
        
        if (providerModels.length > 0) {
          console.log(`  ✓ 获取到 ${providerModels.length} 个模型`);
          models.push(...providerModels);
        } else {
          console.warn(`  ⚠ ${providerName} 没有返回模型`);
        }
      }
    }

    // 提取 MCP 配置（如果有）
    const mcp = config.mcp || {};

    console.log(`\n✓ 总计: ${models.length} 个模型来自 ${Object.keys(providers).length} 个 provider`);

    return {
      providers,
      models,
      mcp,
      _raw: config
    };
  }

  /**
   * 尝试从 OpenCodex 代理服务获取统一模型列表
   * @param {string} proxyUrl - 代理服务的 /v1/models URL
   * @param {Object} providers - provider 配置对象
   * @returns {Promise<{success: boolean, models: Array}>}
   */
  static async tryFetchFromProxy(proxyUrl, providers) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3秒超时

      const response = await fetch(proxyUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
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
      // 静默失败，返回 success: false
      return { success: false, models: [] };
    }
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
