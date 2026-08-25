#!/usr/bin/env node

/**
 * workbuddy-adapter.mjs
 * WorkBuddy 适配器
 * 模型配置: ~/.workbuddy/models.json
 * MCP 配置: ~/.workbuddy/mcp.json
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { BaseAdapter } from './base-adapter.mjs';

export class WorkBuddyAdapter extends BaseAdapter {
  constructor() {
    super('WorkBuddy', 'workbuddy');
    this.supportsModels = true;
    this.supportsMcp = true;
    this.modelStatus = 'supported';
    this.mcpStatus = 'supported';
    this.configFormat = 'json';
  }

  getConfigPath() {
    // 返回模型配置文件路径
    return path.join(os.homedir(), '.workbuddy', 'models.json');
  }

  /**
   * 获取 MCP 配置文件路径
   */
  getMcpConfigPath() {
    return path.join(os.homedir(), '.workbuddy', 'mcp.json');
  }

  /**
   * 读取现有的 MCP 服务器列表
   * @returns {Array<{name: string, enabled: boolean}>}
   */
  getMcpServers() {
    const mcpConfigPath = this.getMcpConfigPath();

    if (!fs.existsSync(mcpConfigPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(mcpConfigPath, 'utf-8');
      const config = JSON.parse(content);
      const servers = config.mcpServers || {};

      return Object.entries(servers).map(([name, server]) => ({
        name,
        enabled: server.disabled !== true,
        config: server
      }));
    } catch (error) {
      console.warn(`    ⚠ 读取 MCP 配置失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 同步模型配置到 models.json
   * @param {Array} models - 增强后的模型列表
   */
  async syncModels(models) {
    const configPath = this.getConfigPath();

    try {
      // 将模型转换为 workbuddy 格式
      const workbuddyModels = models.map(model => {
        const item = {
          id: model.modelId,
          name: model.name,
          vendor: model.vendor || 'Custom',
          url: model.providerConfig.baseUrl || '',
          apiKey: model.providerConfig.apiKey || '',
          supportsToolCall: model.supportsToolCall ?? true,
          supportsImages: model.supportsVision ?? false,
          supportsReasoning: model.supportsReasoning ?? false,
          useCustomProtocol: false
        };

        // 添加最大输入/输出 token 数
        if (model.contextWindow) {
          item.maxInputTokens = model.contextWindow;
        }
        if (model.maxOutputTokens) {
          item.maxOutputTokens = model.maxOutputTokens;
        }

        // 如果有推理配置，添加完整的 reasoning 字段
        if (model.reasoning) {
          item.reasoning = {
            defaultEffort: model.reasoning.defaultEffort || 'high',
            supportedEfforts: model.reasoning.supportedEfforts || ['high', 'max']
          };
        }

        return item;
      });

      // 写入配置文件
      fs.writeFileSync(configPath, JSON.stringify(workbuddyModels, null, 2), 'utf-8');
      console.log(`      ✓ 写入 ${models.length} 个模型配置`);
    } catch (error) {
      throw new Error(`同步模型失败: ${error.message}`);
    }
  }

  /**
   * 同步 MCP 配置到 mcp.json
   * @param {Object} mcpServers - MCP 服务器配置
   */
  async syncMcp(mcpServers) {
    const mcpConfigPath = this.getMcpConfigPath();

    try {
      // 读取现有配置
      let config = { mcpServers: {} };
      if (fs.existsSync(mcpConfigPath)) {
        const content = fs.readFileSync(mcpConfigPath, 'utf-8');
        config = JSON.parse(content);
      }

      // 确保 mcpServers 对象存在
      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      // 收集被禁用的服务器名称
      const disabledNames = new Set();
      for (const [name, server] of Object.entries(mcpServers)) {
        if (server.enabled === false) {
          disabledNames.add(name);
        }
      }

      // 移除被禁用的服务器
      if (disabledNames.size > 0) {
        for (const name of disabledNames) {
          if (config.mcpServers[name]) {
            delete config.mcpServers[name];
            console.log(`      - 移除(禁用): ${name}`);
          }
        }
      }

      // 转换并添加/更新 MCP 配置
      for (const [name, server] of Object.entries(mcpServers)) {
        if (disabledNames.has(name)) continue; // 禁用的不写入

        const workbuddyServer = this.convertToWorkBuddyMcpFormat(server);

        if (config.mcpServers[name]) {
          // 更新现有服务器
          config.mcpServers[name] = workbuddyServer;
          console.log(`      ↻ 更新: ${name}`);
        } else {
          // 添加新服务器
          config.mcpServers[name] = workbuddyServer;
          console.log(`      + 新增: ${name}`);
        }
      }

      // 写入 MCP 配置
      fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2), 'utf-8');

      const activeNames = Object.keys(mcpServers).filter(n => !disabledNames.has(n));
      const existingNames = Object.keys(config.mcpServers);
      const added = activeNames.filter(name => !existingNames.includes(name)).length;
      const updated = activeNames.filter(name => existingNames.includes(name)).length;
      console.log(`      ✓ 完成: 新增 ${added} 个, 更新 ${updated} 个`);
    } catch (error) {
      throw new Error(`同步 MCP 失败: ${error.message}`);
    }
  }

  /**
   * 将通用 MCP 配置转换为 WorkBuddy 格式
   */
  convertToWorkBuddyMcpFormat(server) {
    const workbuddyServer = {};

    // 根据服务器类型转换配置
    const isRemote = server.transport === 'streamable-http' || server.transport === 'sse' || !!server.url;

    if (isRemote) {
      // 远程服务器配置
      workbuddyServer.type = 'streamableHttp';
      if (server.url) {
        workbuddyServer.url = server.url;
      }
      if (server.headers && Object.keys(server.headers).length > 0) {
        workbuddyServer.headers = server.headers;
      }
    } else {
      // 本地服务器配置
      workbuddyServer.type = 'stdio';
      if (server.command) {
        workbuddyServer.command = server.command;
      }
      if (server.args && server.args.length > 0) {
        workbuddyServer.args = server.args;
      }
      if (server.env && Object.keys(server.env).length > 0) {
        workbuddyServer.env = server.env;
      }
    }

    // 处理 disabled 字段
    if (server.disabled === true || server.enabled === false) {
      workbuddyServer.disabled = true;
    }

    // 处理禁用的工具列表
    if (server.disabledTools && server.disabledTools.length > 0) {
      workbuddyServer.disabledTools = server.disabledTools;
    }

    return workbuddyServer;
  }

  /**
   * 删除不在 keepNames 里的 MCP 服务器（force-mcp 重置用）
   */
  async clearMcpExcept(keepNames, { dryRun = false } = {}) {
    const mcpConfigPath = this.getMcpConfigPath();

    if (!fs.existsSync(mcpConfigPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(mcpConfigPath, 'utf-8');
      const config = JSON.parse(content);
      const servers = config.mcpServers || {};

      const removedNames = [];
      const keptServers = {};

      // 遍历现有服务器，只保留在 keepNames 中的
      for (const [name, server] of Object.entries(servers)) {
        if (keepNames.has(name)) {
          keptServers[name] = server;
        } else {
          removedNames.push(name);
        }
      }

      // 写入更新后的配置
      if (!dryRun && removedNames.length > 0) {
        config.mcpServers = keptServers;
        fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2), 'utf-8');
      }

      return removedNames;
    } catch (error) {
      console.warn(`    ⚠ clearMcpExcept 失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 删除指定的 MCP 服务器（矩阵 'remove' 值用）
   */
  async deleteMcp(names, { dryRun = false } = {}) {
    const mcpConfigPath = this.getMcpConfigPath();

    if (!fs.existsSync(mcpConfigPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(mcpConfigPath, 'utf-8');
      const config = JSON.parse(content);
      const servers = config.mcpServers || {};

      const deleteSet = new Set(names);
      const removedNames = [];
      const keptServers = {};

      // 遍历现有服务器，删除指定的
      for (const [name, server] of Object.entries(servers)) {
        if (deleteSet.has(name)) {
          removedNames.push(name);
        } else {
          keptServers[name] = server;
        }
      }

      // 写入更新后的配置
      if (!dryRun && removedNames.length > 0) {
        config.mcpServers = keptServers;
        fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2), 'utf-8');
      }

      return removedNames;
    } catch (error) {
      console.warn(`    ⚠ deleteMcp 失败: ${error.message}`);
      return [];
    }
  }
}
