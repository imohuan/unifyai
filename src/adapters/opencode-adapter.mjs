#!/usr/bin/env node

/**
 * opencode-adapter.mjs
 * OpenCode 适配器（模型 + MCP）
 */

import path from 'node:path';
import os from 'node:os';
import { BaseAdapter } from './base-adapter.mjs';
import { VariantsGenerator } from '../core/variants-generator.mjs';

export class OpenCodeAdapter extends BaseAdapter {
  constructor() {
    super('OpenCode');
    this.supportsModels = true;
    this.supportsMcp = true;
  }

  getConfigPath() {
    return path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  }

  /**
   * 同步模型配置
   */
  async syncModels(models) {
    const raw = this.readExistingConfig();
    if (!raw) {
      throw new Error('配置文件不存在');
    }

    const config = this.parseJsonc(raw);

    // 确保 provider 对象存在
    if (!config.provider) {
      config.provider = {};
    }

    // 按 provider 分组
    const providerGroups = this.groupByProvider(models);

    // 更新每个 provider 的配置
    for (const [providerName, group] of Object.entries(providerGroups)) {
      const providerKey = this.generateProviderKey(providerName, group.config);

      config.provider[providerKey] = {
        name: providerName.toLowerCase(),
        npm: this.detectNpmPackage(group.config.adapter),
        options: {
          baseURL: group.config.baseUrl,
          apiKey: group.config.apiKey
        },
        models: group.models
      };

      console.log(`    • ${providerKey}: ${Object.keys(group.models).length} 个模型`);
    }

    // 写入配置
    this.writeConfig(JSON.stringify(config, null, 2));
  }

  /**
   * 同步 MCP 配置
   */
  async syncMcp(mcpServers) {
    const raw = this.readExistingConfig();
    if (!raw) {
      throw new Error('配置文件不存在');
    }

    const config = this.parseJsonc(raw);

    // 确保 mcp 对象存在
    if (!config.mcp) {
      config.mcp = {};
    }

    // 转换 MCP 配置
    for (const [name, server] of Object.entries(mcpServers)) {
      const isRemote = server.transport === 'streamable-http' || server.transport === 'sse' || !!server.url;

      config.mcp[name] = {
        type: isRemote ? 'remote' : 'local',
        enabled: server.enabled !== false
      };

      if (isRemote) {
        // 远程服务器
        config.mcp[name].url = server.url;

        if (server.bearerToken) {
          config.mcp[name].headers = {
            Authorization: `Bearer ${server.bearerToken}`
          };
        }
      } else {
        // 本地服务器
        const command = [server.command, ...(server.args || [])];
        config.mcp[name].command = command;

        if (server.env && Object.keys(server.env).length > 0) {
          config.mcp[name].environment = server.env;
        }
      }

      console.log(`    • ${name}: ${isRemote ? 'remote' : 'local'}`);
    }

    // 写入配置
    this.writeConfig(JSON.stringify(config, null, 2));
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
          models: {}
        };
      }

      // 构建模型配置
      const modelConfig = {
        name: model.modelId,
        limit: {
          context: model.contextWindow || 200000,
          output: model.maxOutputTokens || 32000
        },
        modalities: {
          input: model.inputModalities || ['text'],
          output: ['text']
        },
        reasoning: model.supportsThinking || false,
        tool_call: model.supportsFunctionCalling !== false
      };

      // 添加 variants（如果需要）
      const variants = VariantsGenerator.generateForOpenCode(model.modelId, model);
      if (variants && Object.keys(variants).length > 0) {
        modelConfig.variants = variants;
      }

      groups[model.provider].models[model.modelId] = modelConfig;
    }

    return groups;
  }

  /**
   * 生成 provider key
   * 格式: providerName-npmPackageName
   * 例如: newapi-openai, newapi-anthropic
   */
  generateProviderKey(providerName, providerConfig) {
    const adapter = providerConfig.adapter || 'openai-chat';
    const npmPackage = this.detectNpmPackage(adapter);
    const packageName = npmPackage.split('/')[1]; // @ai-sdk/openai → openai

    return `${providerName.toLowerCase()}-${packageName}`;
  }

  /**
   * 根据 adapter 类型检测 npm 包
   */
  detectNpmPackage(adapter) {
    if (!adapter) {
      return '@ai-sdk/openai';
    }

    const lower = adapter.toLowerCase();

    if (lower.includes('anthropic')) {
      return '@ai-sdk/anthropic';
    } else if (lower.includes('deepseek')) {
      return '@ai-sdk/deepseek';
    } else if (lower.includes('openai-compatible')) {
      return '@ai-sdk/openai-compatible';
    } else if (lower.includes('openai')) {
      return '@ai-sdk/openai';
    }

    // 默认返回 openai
    return '@ai-sdk/openai';
  }
}
