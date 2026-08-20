#!/usr/bin/env node

/**
 * opencode-adapter.mjs
 * OpenCode 适配器（模型 + MCP）
 * 
 * 关键特性：
 * - 按 SDK 包分组模型（@ai-sdk/openai, @ai-sdk/anthropic 等）
 * - 同一 provider 的不同 SDK 模型需要分开配置
 * - 例如：newapi-openai, newapi-anthropic, newapi-deepseek
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
    this.modelStatus = 'supported';
    this.mcpStatus = 'supported';
    this.configFormat = 'jsonc';
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

    // 按 SDK 分组模型
    const sdkGroups = this.groupBySdk(models);

    // 收集所有来自同步的 provider keys
    const syncedProviderKeys = new Set();
    for (const [sdk, group] of Object.entries(sdkGroups)) {
      const providerKey = this.generateProviderKey(group.providerName, sdk);
      syncedProviderKeys.add(providerKey);
    }

    // 清空所有模型配置
    const oldProviderCount = Object.keys(config.provider || {}).length;
    if (oldProviderCount > 0) {
      console.log(`    清空旧配置: ${oldProviderCount} 个 provider`);
    }
    
    config.provider = {};

    // 添加新的同步配置
    for (const [groupKey, group] of Object.entries(sdkGroups)) {
      const providerKey = this.generateProviderKey(group.providerName, group.sdk);

      config.provider[providerKey] = {
        name: group.providerName.toLowerCase(),
        npm: group.sdk,
        options: {
          baseURL: group.baseUrl,
          apiKey: group.apiKey
        },
        models: group.models
      };

      console.log(`    • ${providerKey} (${group.sdk}): ${Object.keys(group.models).length} 个模型`);
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

    // 转换 MCP 配置到 OpenCode 格式
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
   * 按 SDK 分组模型
   * 同一个 provider 的不同 SDK 模型会被分到不同组
   */
  groupBySdk(models) {
    const groups = {};

    for (const model of models) {
      // 检测模型所属的 SDK
      const sdk = this.detectSdk(model.modelId);
      const groupKey = `${model.provider}::${sdk}`;

      if (!groups[groupKey]) {
        groups[groupKey] = {
          providerName: model.provider,
          sdk: sdk,
          baseUrl: model.providerConfig.baseUrl,
          apiKey: model.providerConfig.apiKey,
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
      if (model.supportsThinking) {
        const variants = VariantsGenerator.generateForOpenCode(model.modelId, model);
        if (variants && Object.keys(variants).length > 0) {
          modelConfig.variants = variants;
        }
      }

      groups[groupKey].models[model.modelId] = modelConfig;
    }

    // 不转换格式，直接返回分组（保留 provider::sdk 作为 key）
    return groups;
  }

  /**
   * 根据模型名称检测应该使用的 SDK
   */
  detectSdk(modelId) {
    const lower = modelId.toLowerCase();

    // Anthropic 系列
    if (lower.includes('claude')) {
      return '@ai-sdk/anthropic';
    }

    // Google 系列
    if (lower.includes('gemini') || lower.includes('palm')) {
      return '@ai-sdk/google';
    }

    // DeepSeek 系列
    if (lower.includes('deepseek')) {
      return '@ai-sdk/openai'; // DeepSeek 也使用 OpenAI SDK
    }

    // Mistral 系列
    if (lower.includes('mistral') || lower.includes('mixtral')) {
      return '@ai-sdk/mistral';
    }

    // Cohere 系列
    if (lower.includes('cohere') || lower.includes('command')) {
      return '@ai-sdk/cohere';
    }

    // xAI 系列
    if (lower.includes('grok')) {
      return '@ai-sdk/xai';
    }

    // OpenAI 和兼容系列（默认）
    if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3')) {
      return '@ai-sdk/openai';
    }

    // 其他所有模型默认使用 openai-compatible
    return '@ai-sdk/openai-compatible';
  }

  /**
   * 生成 provider key
   * 格式: providerName-sdkName
   * 例如: newapi-openai, newapi-anthropic, newapi-deepseek
   */
  generateProviderKey(providerName, sdk) {
    // 从 @ai-sdk/xxx 提取 xxx
    const sdkName = sdk.split('/')[1] || 'openai';
    return `${providerName.toLowerCase()}-${sdkName}`;
  }
}
