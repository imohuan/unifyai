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

    // 从每个 provider 获取模型列表
    const models = [];
    
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
