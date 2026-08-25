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
    super('PenguinHarness', 'penguin'); // 显式传 id，CLI 参数用 'penguin'
    this.supportsModels = true;
    this.supportsMcp = true; // PenguinHarness 支持 MCP
    this.modelStatus = 'supported';
    this.mcpStatus = 'supported';
    this.configFormat = 'toml';
  }

  getConfigPath() {
    // 使用 ~ 下的 .penguin 目录（仅用于兼容性，实际同步时会找所有项目）
    return path.join(os.homedir(), '.penguin', 'data', 'default_project', '.project_config.toml');
  }

  /**
   * 查找所有项目的 .project_config.toml 文件
   */
  findProjectConfigs() {
    const dataDir = path.join(os.homedir(), '.penguin', 'data');
    const results = [];

    if (!fs.existsSync(dataDir)) {
      return results;
    }

    try {
      const entries = fs.readdirSync(dataDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const configPath = path.join(dataDir, entry.name, '.project_config.toml');
          if (fs.existsSync(configPath)) {
            results.push(configPath);
          }
        }
      }
    } catch (error) {
      console.warn(`    ⚠ 读取项目目录失败: ${error.message}`);
    }

    return results;
  }

  /**
   * 同步模型配置到所有项目
   * PenguinHarness 使用 TOML 格式，包含：
   * - default_model: 默认模型配置
   * - [[models]]: 模型数组
   */
  async syncModels(models) {
    const projectConfigs = this.findProjectConfigs();

    if (projectConfigs.length === 0) {
      console.warn('    ⚠ 未找到任何项目配置文件');
      return;
    }

    console.log(`    找到 ${projectConfigs.length} 个项目配置文件`);

    let successCount = 0;
    let failCount = 0;

    for (const configPath of projectConfigs) {
      try {
        const projectName = path.basename(path.dirname(configPath));
        console.log(`    → 更新项目: ${projectName}`);

        this.syncProjectModels(configPath, models);
        console.log(`      ✓ 写入 ${models.length} 个模型配置`);
        successCount++;
      } catch (error) {
        console.error(`      ✗ 更新失败: ${error.message}`);
        failCount++;
      }
    }

    console.log(`    完成: ${successCount} 成功, ${failCount} 失败`);
  }

  /**
   * 同步单个项目的模型配置
   */
  syncProjectModels(configPath, models) {
    const raw = fs.readFileSync(configPath, 'utf-8');
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
        
        // client_type 从 providerConfig.adapter 转换而来（model 上没有 clientType 字段）
        const clientType = this.toClientType(model.providerConfig && model.providerConfig.adapter);
        if (clientType) {
          newLines.push(`client_type = "${clientType}"`);
        }
        
        if (model.maxOutputTokens) {
          newLines.push(`max_tokens = ${model.maxOutputTokens}`);
        }
        
        // 显式声明 vision 支持（使用增强后的 supportsVision 字段）
        if (model.supportsVision) {
          newLines.push('vision = true');
        } else {
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

    // 写入配置到指定路径
    fs.writeFileSync(configPath, newLines.join('\n'), 'utf-8');
  }

  /**
   * 将 opencodex provider 的 adapter 转换为 PenguinHarness 的 client_type
   * 协议对应关系：
   *   openai-chat      -> OpenAI Chat Completions  (/chat/completions)
   *   openai-responses -> OpenAI Responses        (/responses)
   *   anthropic        -> Anthropic Messages      (/v1/messages)
   * 其他 adapter（google/kiro/cursor 等）无法映射时返回 null，不写入 client_type
   * @param {string} adapter - opencodex provider 的 adapter 值
   * @returns {string|null}
   */
  toClientType(adapter) {
    if (!adapter) return null;
    switch (adapter) {
      case 'openai-chat':
      case 'openai-responses':
        return adapter;
      case 'anthropic':
        return 'ant-messages';
      default:
        return null;
    }
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

        // 收集被禁用的服务器（Penguin 的 mcpServers 无 enabled 字段，关闭 = 移除条目）
        const disabledNames = new Set();
        for (const [name, server] of Object.entries(mcpServers)) {
          if (server.enabled === false) disabledNames.add(name);
        }

        // 从数组中移除被禁用的服务器
        if (disabledNames.size > 0) {
          const before = config.tools.mcpServers.length;
          config.tools.mcpServers = config.tools.mcpServers.filter(
            s => !disabledNames.has(s.name)
          );
          const removed = before - config.tools.mcpServers.length;
          if (removed > 0) {
            console.log(`      - 移除(禁用): ${[...disabledNames].join(', ')}`);
          }
        }

        // 重建名称到索引的映射（用于查找重复）
        const existingServers = new Map();
        config.tools.mcpServers.forEach((server, index) => {
          existingServers.set(server.name, index);
        });

        // 转换 MCP 配置到 PenguinHarness 格式（增量添加/更新）
        for (const [name, server] of Object.entries(mcpServers)) {
          if (disabledNames.has(name)) continue; // 禁用的不写入

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

          // 检查是否已存在同名服务器
          if (existingServers.has(name)) {
            // 覆盖已存在的服务器
            const index = existingServers.get(name);
            config.tools.mcpServers[index] = mcpConfig;
            console.log(`      ↻ 更新: ${name}`);
          } else {
            // 添加新服务器
            config.tools.mcpServers.push(mcpConfig);
            console.log(`      + 新增: ${name}`);
          }
        }

        // 写回 YAML 文件（保持格式）
        const newYamlContent = yaml.dump(config, {
          indent: 2,
          lineWidth: 80,
          noRefs: true,
          sortKeys: false
        });

        fs.writeFileSync(configPath, newYamlContent, 'utf-8');
        
        const activeNames = Object.keys(mcpServers).filter(n => !disabledNames.has(n));
        const added = activeNames.filter(name => !existingServers.has(name)).length;
        const updated = activeNames.filter(name => existingServers.has(name)).length;
        console.log(`      ✓ 完成: 新增 ${added} 个, 更新 ${updated} 个`);
        successCount++;

      } catch (error) {
        console.error(`      ✗ 更新失败: ${error.message}`);
        failCount++;
      }
    }

    console.log(`    完成: ${successCount} 成功, ${failCount} 失败`);
  }

  /**
   * 删除 tools.mcpServers 数组中不在 keepNames 里的条目（force-mcp 重置用）
   * Penguin 配置文件: tools.mcpServers 数组（每个元素含 name 字段）
   * 遍历所有 system_config.yaml 统一处理
   */
  async clearMcpExcept(keepNames, { dryRun = false } = {}) {
    const dataDir = path.join(os.homedir(), '.penguin', 'data');
    if (!fs.existsSync(dataDir)) return [];
    const configFiles = this.findSystemConfigs(dataDir);
    const removedSet = new Set();
    for (const configPath of configFiles) {
      try {
        const yamlContent = fs.readFileSync(configPath, 'utf-8');
        const config = yaml.load(yamlContent);
        const arr = config?.tools?.mcpServers;
        if (!Array.isArray(arr)) continue;
        const kept = arr.filter(s => s && keepNames.has(s.name));
        const removedHere = arr.filter(s => s && !keepNames.has(s.name));
        if (removedHere.length > 0) {
          for (const s of removedHere) {
            if (s?.name) removedSet.add(s.name);
          }
          if (!dryRun) {
            config.tools.mcpServers = kept;
            fs.writeFileSync(configPath, yaml.dump(config, { indent: 2, lineWidth: 80, noRefs: true, sortKeys: false }), 'utf-8');
          }
        }
      } catch (e) {
        console.warn(`      ⚠ ${path.basename(configPath)}: ${e.message}`);
      }
    }
    return [...removedSet];
  }

  /** 删除指定的 MCP 服务器条目（矩阵 'remove' 值）——跨所有 system_config.yaml */
  async deleteMcp(names, { dryRun = false } = {}) {
    const dataDir = path.join(os.homedir(), '.penguin', 'data');
    if (!fs.existsSync(dataDir)) return [];
    const deleteSet = new Set(names);
    const configFiles = this.findSystemConfigs(dataDir);
    const removedSet = new Set();
    for (const configPath of configFiles) {
      try {
        const yamlContent = fs.readFileSync(configPath, 'utf-8');
        const config = yaml.load(yamlContent);
        const arr = config?.tools?.mcpServers;
        if (!Array.isArray(arr)) continue;
        const before = arr.length;
        const kept = arr.filter(s => s && !deleteSet.has(s.name));
        const removedHere = before - kept.length;
        if (removedHere > 0) {
          for (const s of arr) {
            if (s?.name && deleteSet.has(s.name)) removedSet.add(s.name);
          }
          if (!dryRun) {
            config.tools.mcpServers = kept;
            fs.writeFileSync(configPath, yaml.dump(config, { indent: 2, lineWidth: 80, noRefs: true, sortKeys: false }), 'utf-8');
          }
        }
      } catch (e) {
        console.warn(`      ⚠ ${path.basename(configPath)}: ${e.message}`);
      }
    }
    return [...removedSet];
  }

  /**
   * 读取 PenguinHarness 现有 MCP 服务器
   * tools.mcpServers 数组无 enabled 字段：条目存在即视为启用
   * 多个 system_config.yaml 的结果按名称去重合并
   */
  getMcpServers() {
    const dataDir = path.join(os.homedir(), '.penguin', 'data');
    if (!fs.existsSync(dataDir)) return [];

    const seen = new Map();
    for (const configPath of this.findSystemConfigs(dataDir)) {
      try {
        const config = yaml.load(fs.readFileSync(configPath, 'utf-8'));
        const servers = config?.tools?.mcpServers || [];
        for (const s of servers) {
          if (s && s.name && !seen.has(s.name)) {
            seen.set(s.name, { name: s.name, enabled: true, config: s });
          }
        }
      } catch {
        // 单个文件解析失败不影响其他文件
      }
    }
    return [...seen.values()];
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
