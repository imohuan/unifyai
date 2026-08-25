#!/usr/bin/env node

/**
 * reasonix-adapter.mjs
 * Reasonix 适配器（模型 + MCP）
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { BaseAdapter } from './base-adapter.mjs';
import { tomlToJson, jsonToToml } from '../core/toml-array-tables.mjs';

export class ReasonixAdapter extends BaseAdapter {
  constructor() {
    super('Reasonix');
    this.supportsModels = true;
    this.supportsMcp = true;
    this.modelStatus = 'supported';
    this.mcpStatus = 'supported';
    this.configFormat = 'toml';
  }

  getConfigPath() {
    const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appdata, 'reasonix', 'config.toml');
  }

  getEnvPath() {
    const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appdata, 'reasonix', '.env');
  }

  /**
   * 读取 .env 文件
   */
  readEnvFile() {
    const envPath = this.getEnvPath();
    if (!fs.existsSync(envPath)) {
      return {};
    }
    
    const content = fs.readFileSync(envPath, 'utf-8');
    const env = {};
    
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const match = trimmed.match(/^([A-Z_0-9]+)=(.*)$/);
      if (match) {
        env[match[1]] = match[2];
      }
    }
    
    return env;
  }

  /**
   * 写入 .env 文件
   */
  writeEnvFile(env) {
    const envPath = this.getEnvPath();
    const lines = [];
    
    for (const [key, value] of Object.entries(env)) {
      lines.push(`${key}=${value}`);
    }
    
    fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
  }

  /**
   * 同步模型配置
   */
  async syncModels(models) {
    const raw = this.readExistingConfig();
    if (!raw) {
      throw new Error('配置文件不存在');
    }

    const config = tomlToJson(raw);

    // 确保 providers 数组存在
    if (!config.providers) {
      config.providers = [];
    }

    // 读取现有的 .env 文件
    const env = this.readEnvFile();

    // 按 provider 分组
    const providerGroups = this.groupByProvider(models);

    // 更新或添加 providers
    for (const [providerName, group] of Object.entries(providerGroups)) {
      // 查找已有 provider
      let provider = config.providers.find(p => p.name === providerName.toLowerCase());

      if (!provider) {
        // 创建新 provider
        provider = {
          name: providerName.toLowerCase(),
          kind: 'openai',
          base_url: group.config.baseUrl,
          api_key_env: `${providerName.toUpperCase()}_API_KEY`
        };
        config.providers.push(provider);
      } else {
        // 更新已有 provider，保留 api_key_env
        provider.base_url = group.config.baseUrl;
        if (!provider.api_key_env) {
          provider.api_key_env = `${providerName.toUpperCase()}_API_KEY`;
        }
      }

      // 更新模型列表
      provider.models = group.models;
      provider.vision_models = group.visionModels;
      provider.default = group.config.defaultModel || group.models[0];

      // 写入 .env 文件
      const envKey = provider.api_key_env;
      env[envKey] = group.config.apiKey;

      console.log(`    • ${providerName}: ${group.models.length} 个模型`);
      console.log(`      ✓ API Key 已写入 .env: ${envKey}`);
    }

    // 写入更新的 .env 文件
    this.writeEnvFile(env);

    // TOML 序列化
    const toml = jsonToToml(config);
    this.writeConfig(toml);
  }

  /**
   * 同步 MCP 配置
   * Reasonix 使用 [[plugins]] 数组表配置 MCP 服务器
   */
  async syncMcp(mcpServers) {
    const raw = this.readExistingConfig();
    if (!raw) {
      throw new Error('配置文件不存在');
    }

    const config = tomlToJson(raw);

    // 确保 plugins 数组存在
    if (!config.plugins) {
      config.plugins = [];
    }

    // 收集被禁用的服务器
    const disabledNames = new Set();
    for (const [name, server] of Object.entries(mcpServers)) {
      if (server.enabled === false) disabledNames.add(name);
    }

    // 从数组中移除被禁用的服务器
    if (disabledNames.size > 0) {
      const before = config.plugins.length;
      config.plugins = config.plugins.filter(p => !disabledNames.has(p.name));
      const removed = before - config.plugins.length;
      if (removed > 0) {
        console.log(`      - 移除(禁用): ${[...disabledNames].join(', ')}`);
      }
    }

    // 重建名称到索引的映射
    const existingPlugins = new Map();
    config.plugins.forEach((plugin, index) => {
      existingPlugins.set(plugin.name, index);
    });

    // 转换 MCP 配置到 Reasonix 格式（增量添加/更新）
    for (const [name, server] of Object.entries(mcpServers)) {
      if (disabledNames.has(name)) continue;

      // 判断是否为远程服务器
      const isRemote = server.transport === 'streamable-http' || server.transport === 'sse' || !!server.url;

      let plugin;
      if (existingPlugins.has(name)) {
        // 更新已存在的 plugin
        plugin = config.plugins[existingPlugins.get(name)];
      } else {
        // 创建新 plugin
        plugin = { name };
        config.plugins.push(plugin);
      }

      if (isRemote) {
        // 远程服务器
        plugin.type = server.transport === 'sse' ? 'sse' : 'http';
        plugin.url = server.url;

        // 处理认证头
        if (server.headers) {
          plugin.headers = server.headers;
        } else {
          delete plugin.headers;
        }

        // 删除 stdio 相关字段
        delete plugin.command;
        delete plugin.args;
        delete plugin.env;
      } else {
        // 本地 stdio 服务器
        plugin.type = 'stdio';
        plugin.command = server.command;

        if (server.args && server.args.length > 0) {
          plugin.args = server.args;
        } else {
          delete plugin.args;
        }

        if (server.env && Object.keys(server.env).length > 0) {
          plugin.env = server.env;
        } else {
          delete plugin.env;
        }

        // 删除 HTTP/SSE 相关字段
        delete plugin.url;
        delete plugin.headers;
      }

      // 设置可选超时配置
      if (server.startupTimeoutSeconds !== undefined) {
        plugin.startup_timeout_seconds = server.startupTimeoutSeconds;
      }
      if (server.callTimeoutSeconds !== undefined) {
        plugin.call_timeout_seconds = server.callTimeoutSeconds;
      }
      if (server.toolTimeoutSeconds) {
        plugin.tool_timeout_seconds = server.toolTimeoutSeconds;
      }

      const typeStr = isRemote ? plugin.type : 'stdio';
      if (existingPlugins.has(name)) {
        console.log(`      ↻ 更新: ${name} (${typeStr})`);
      } else {
        console.log(`      + 新增: ${name} (${typeStr})`);
      }
    }

    // TOML 序列化
    const toml = jsonToToml(config);
    this.writeConfig(toml);
  }

  /**
   * 读取 Reasonix 现有 MCP 服务器及启用状态
   * Reasonix 的 MCP 服务器配置在 [[plugins]] 数组表中
   * 无 enabled 字段：存在即视为启用（关闭 = 条目被移除）
   * @returns {Array<{name: string, enabled: boolean, config: Object}>|null}
   */
  getMcpServers() {
    const raw = this.readExistingConfig();
    if (!raw) return [];
    const config = tomlToJson(raw);
    const plugins = config.plugins;
    if (!Array.isArray(plugins)) return [];
    return plugins
      .filter(p => p && p.name)
      .map(p => ({
        name: p.name,
        enabled: true, // Reasonix 无 enabled 字段
        config: p
      }));
  }

  /**
   * 清空除了保留列表外的所有 MCP 配置
   */
  async clearMcpExcept(keepNames, { dryRun = false } = {}) {
    const raw = this.readExistingConfig();
    if (!raw) return [];

    const config = tomlToJson(raw);
    const plugins = config.plugins;
    if (!Array.isArray(plugins) || plugins.length === 0) return [];

    const kept = plugins.filter(p => p && keepNames.has(p.name));
    const removedHere = plugins.filter(p => p && !keepNames.has(p.name));

    if (removedHere.length > 0) {
      const removedSet = new Set();
      for (const p of removedHere) {
        if (p?.name) removedSet.add(p.name);
      }

      if (!dryRun) {
        config.plugins = kept;
        const toml = jsonToToml(config);
        this.writeConfig(toml);
      }

      return [...removedSet];
    }

    return [];
  }

  /**
   * 删除指定的 MCP 服务器条目
   */
  async deleteMcp(names, { dryRun = false } = {}) {
    const raw = this.readExistingConfig();
    if (!raw) return [];

    const config = tomlToJson(raw);
    const plugins = config.plugins;
    if (!Array.isArray(plugins) || plugins.length === 0) return [];

    const deleteSet = new Set(names);
    const before = plugins.length;
    const kept = plugins.filter(p => p && !deleteSet.has(p.name));
    const removedCount = before - kept.length;

    if (removedCount > 0) {
      const removedSet = new Set();
      for (const p of plugins) {
        if (p?.name && deleteSet.has(p.name)) removedSet.add(p.name);
      }

      if (!dryRun) {
        config.plugins = kept;
        const toml = jsonToToml(config);
        this.writeConfig(toml);
      }

      return [...removedSet];
    }

    return [];
  }

  /**
   * 按 provider 分组模型
   */
  groupByProvider(models) {
    const groups = {};

    for (const model of models) {
      if (!groups[model.provider]) {
        groups[model.provider] = {
          config: model.providerConfig,
          models: [],
          visionModels: []
        };
      }

      groups[model.provider].models.push(model.modelId);

      if (model.supportsVision) {
        groups[model.provider].visionModels.push(model.modelId);
      }
    }

    return groups;
  }
}
