#!/usr/bin/env node

/**
 * penguin-adapter.mjs
 * PenguinHarness 适配器
 * 模型配置: ~/.penguin/data/default_project/.project_config.toml
 * MCP 配置: ~/.penguin/data/ * /agents/ * /agent_state/system_config.yaml
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import * as yaml from 'js-yaml';
import { BaseAdapter } from './base-adapter.mjs';

export class PenguinAdapter extends BaseAdapter {
  constructor() {
    super('PenguinHarness');
    this.supportsModels = true;
    this.supportsMcp = true; // PenguinHarness 支持 MCP
  }

  getConfigPath() {
    // 使用 ~ 下的 .penguin 目录
    return path.join(os.homedir(), '.penguin', 'data', 'default_project', '.project_config.toml');
  }

  /**
   * 同步模型配置
   * PenguinHarness 使用 TOML 格式，包含：
   * - default_model: 默认模型配置
   * - [[models]]: 模型数组
   */
  async syncModels(models) {
    const raw = this.readExistingConfig();
    if (!raw) {
      throw new Error('配置文件不存在');
    }

    // 解析现有的 TOML 配置
    const existingLines = raw.split('\n');
    const newLines = [];
    let inModelsSection = false;

    // 保留 default_model 行
    for (const line of existingLines) {
      if (line.trim().startsWith('default_model')) {
        newLines.push(line);
        break;
      }
    }

    newLines.push(''); // 空行分隔

    // 按 provider 分组模型
    const groupedModels = this.groupByProvider(models);

    // 生成新的模型配置
    for (const [providerKey, group] of Object.entries(groupedModels)) {
      for (const model of group.models) {
        newLines.push('[[models]]');
        newLines.push(`provider = "${model.provider}"`);
        newLines.push(`model_id = "${model.modelId}"`);
        
        if (model.providerConfig.baseUrl) {
          newLines.push(`base_url = "${model.providerConfig.baseUrl}"`);
        }
        
        if (model.providerConfig.apiKey) {
          newLines.push(`api_key = "${model.providerConfig.apiKey}"`);
        }
        
        newLines.push(`context_window = ${model.contextWindow || 200000}`);
        
        if (model.clientType) {
          newLines.push(`client_type = "${model.clientType}"`);
        }
        
        if (model.maxOutputTokens) {
          newLines.push(`max_tokens = ${model.maxOutputTokens}`);
        }
        
        if (model.inputModalities && !model.inputModalities.includes('image')) {
          newLines.push('vision = false');
        }

        // 添加定价信息（如果有）
        if (model.pricing) {
          newLines.push('');
          newLines.push('[models.pricing]');
          newLines.push(`unit = "${model.pricing.unit || 'usd_per_mtok'}"`);
          
          if (model.pricing.cacheRead !== undefined) {
            newLines.push(`cache_read = ${model.pricing.cacheRead}`);
          }
          if (model.pricing.cacheWrite !== undefined) {
            newLines.push(`cache_write = ${model.pricing.cacheWrite}`);
          }
          if (model.pricing.output !== undefined) {
            newLines.push(`output = ${model.pricing.output}`);
          }
        }

        newLines.push(''); // 模型之间的空行
      }
    }

    // 写入配置
    this.writeConfig(newLines.join('\n'));
    
    console.log(`    写入 ${models.length} 个模型配置`);
  }

  /**
   * 按 provider 分组模型
   */
  groupByProvider(models) {
    const groups = {};

    for (const model of models) {
      const providerKey = model.provider.toLowerCase();

      if (!groups[providerKey]) {
        groups[providerKey] = {
          providerName: model.provider,
          models: []
        };
      }

      groups[providerKey].models.push(model);
    }

    return groups;
  }

  /**
   * 解析 TOML（简单实现，仅支持基本的键值对和表）
   */
  parseToml(text) {
    const result = { models: [] };
    const lines = text.split('\n');
    let currentModel = null;
    let currentSection = null;

    for (let line of lines) {
      line = line.trim();

      // 跳过空行和注释
      if (!line || line.startsWith('#')) continue;

      // 检测数组表 [[models]]
      if (line === '[[models]]') {
        if (currentModel) {
          result.models.push(currentModel);
        }
        currentModel = {};
        currentSection = null;
        continue;
      }

      // 检测表 [models.pricing]
      if (line.startsWith('[') && line.endsWith(']')) {
        const sectionName = line.slice(1, -1);
        if (sectionName === 'models.pricing' && currentModel) {
          currentModel.pricing = {};
          currentSection = 'pricing';
        }
        continue;
      }

      // 解析键值对
      const match = line.match(/^(\w+)\s*=\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        const parsedValue = this.parseTomlValue(value);

        if (currentSection === 'pricing' && currentModel) {
          currentModel.pricing[key] = parsedValue;
        } else if (currentModel) {
          currentModel[key] = parsedValue;
        } else {
          result[key] = parsedValue;
        }
      }
    }

    // 添加最后一个模型
    if (currentModel) {
      result.models.push(currentModel);
    }

    return result;
  }

  /**
   * 解析 TOML 值
   */
  parseTomlValue(value) {
    value = value.trim();

    // 字符串
    if (value.startsWith('"') && value.endsWith('"')) {
      return value.slice(1, -1);
    }

    // 布尔值
    if (value === 'true') return true;
    if (value === 'false') return false;

    // 数字
    if (!isNaN(value)) {
      return Number(value);
    }

    // 对象（简单实现）
    if (value.startsWith('{') && value.endsWith('}')) {
      try {
        // 将 TOML 对象转换为 JSON
        const jsonStr = value.replace(/(\w+)\s*=/g, '"$1":');
        return JSON.parse(jsonStr);
      } catch {
        return value;
      }
    }

    return value;
  }

  /**
   * 同步 MCP 配置
   * 搜索 ~/.penguin/data/ 下所有 system_config.yaml
   * 更新 tools.mcpServers 配置
   */
  async syncMcp(mcpServers) {
    const dataDir = path.join(os.homedir(), '.penguin', 'data');
    
    if (!fs.existsSync(dataDir)) {
      console.warn(`    ⚠ PenguinHarness 数据目录不存在: ${dataDir}`);
      return;
    }

    // 搜索所有 system_config.yaml 文件
    const configFiles = this.findSystemConfigs(dataDir);
    
    if (configFiles.length === 0) {
      console.warn(`    ⚠ 未找到任何 system_config.yaml 文件`);
      return;
    }

    console.log(`    找到 ${configFiles.length} 个 system_config.yaml 文件`);

    let successCount = 0;
    let failCount = 0;

    // 更新每个配置文件
    for (const configPath of configFiles) {
      try {
        const relativePath = path.relative(dataDir, configPath);
        console.log(`    → 更新: ${relativePath}`);

        // 读取 YAML 配置
        const yamlContent = fs.readFileSync(configPath, 'utf-8');
        const config = yaml.load(yamlContent);

        // 确保 tools.mcpServers 存在
        if (!config.tools) {
          config.tools = {};
        }
        if (!config.tools.mcpServers) {
          config.tools.mcpServers = [];
        }

        // 清空现有的 MCP 服务器配置
        config.tools.mcpServers = [];

        // 转换 MCP 配置到 PenguinHarness 格式
        for (const [name, server] of Object.entries(mcpServers)) {
          const isRemote = server.transport === 'streamable-http' || server.transport === 'sse' || !!server.url;

          const mcpConfig = {
            name: name,
            config: {}
          };

          if (isRemote) {
            // 远程服务器
            mcpConfig.config.transport = server.transport === 'sse' ? 'sse' : 'http';
            mcpConfig.config.url = server.url;

            if (server.bearerToken || server.headers?.Authorization) {
              mcpConfig.config.headers = {
                Authorization: server.bearerToken 
                  ? `Bearer ${server.bearerToken}` 
                  : server.headers.Authorization
              };
            }
          } else {
            // 本地服务器
            mcpConfig.config.transport = 'stdio';
            mcpConfig.config.command = server.command;
            
            if (server.args && server.args.length > 0) {
              mcpConfig.config.args = server.args;
            }

            if (server.env && Object.keys(server.env).length > 0) {
              mcpConfig.config.env = server.env;
            }
          }

          config.tools.mcpServers.push(mcpConfig);
        }

        // 写回 YAML 文件（保持格式）
        const newYamlContent = yaml.dump(config, {
          indent: 2,
          lineWidth: 80,
          noRefs: true,
          sortKeys: false
        });

        fs.writeFileSync(configPath, newYamlContent, 'utf-8');
        console.log(`      ✓ 已更新 ${Object.keys(mcpServers).length} 个 MCP 服务器`);
        successCount++;

      } catch (error) {
        console.error(`      ✗ 更新失败: ${error.message}`);
        failCount++;
      }
    }

    console.log(`    完成: ${successCount} 成功, ${failCount} 失败`);
  }

  /**
   * 递归搜索所有 system_config.yaml 文件
   */
  findSystemConfigs(dir) {
    const results = [];

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // 递归搜索子目录
          results.push(...this.findSystemConfigs(fullPath));
        } else if (entry.isFile() && entry.name === 'system_config.yaml') {
          // 找到目标文件
          results.push(fullPath);
        }
      }
    } catch (error) {
      // 忽略权限错误等
      if (error.code !== 'EACCES' && error.code !== 'EPERM') {
        console.warn(`      ⚠ 读取目录失败 ${dir}: ${error.message}`);
      }
    }

    return results;
  }
}
