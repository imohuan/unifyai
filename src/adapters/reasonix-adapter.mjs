#!/usr/bin/env node

/**
 * reasonix-adapter.mjs
 * Reasonix 适配器（模型 + MCP）
 */

import path from 'node:path';
import os from 'node:os';
import { BaseAdapter } from './base-adapter.mjs';
import { tomlToJson, jsonToToml } from '../core/toml-stable.mjs';

export class ReasonixAdapter extends BaseAdapter {
  constructor() {
    super('Reasonix');
    this.supportsModels = true;
    this.supportsMcp = true;
    this.modelStatus = 'supported';
    this.mcpStatus = 'not_implemented'; // syncMcp 是 TODO，同步时跳过
    this.configFormat = 'toml';
  }

  getConfigPath() {
    const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appdata, 'reasonix', 'config.toml');
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
        // 更新已有 provider
        provider.base_url = group.config.baseUrl;
      }

      // 更新模型列表
      provider.models = group.models;
      provider.vision_models = group.visionModels;
      provider.default = group.config.defaultModel || group.models[0];

      console.log(`    • ${providerName}: ${group.models.length} 个模型`);
      console.log(`      提示: 请设置环境变量 ${provider.api_key_env}=${group.config.apiKey}`);
    }

    // JSON → TOML
    const toml = jsonToToml(config);
    this.writeConfig(toml);
  }

  /**
   * 同步 MCP 配置
   * 注意：Reasonix 的 MCP 配置格式需要进一步调查
   * 目前先跳过实现
   */
  async syncMcp(mcpServers) {
    console.log(`    ⚠ Reasonix MCP 配置格式待调查，暂时跳过`);
    // TODO: 实现 Reasonix MCP 同步
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
