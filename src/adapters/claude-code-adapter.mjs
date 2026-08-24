#!/usr/bin/env node

/**
 * claude-code-adapter.mjs
 * Claude Code 适配器（仅 MCP）
 * 模型配置由 opencodex 代理，只需同步 MCP
 */

import path from 'node:path';
import os from 'node:os';
import { BaseAdapter } from './base-adapter.mjs';

export class ClaudeCodeAdapter extends BaseAdapter {
  constructor() {
    super('Claude Code');
    this.supportsModels = false; // opencodex 已支持
    this.supportsMcp = true;
    this.modelStatus = 'not_supported';
    this.mcpStatus = 'supported';
    this.configFormat = 'json';
  }

  getConfigPath() {
    return path.join(os.homedir(), '.claude.json');
  }

  /**
   * 同步 MCP 配置
   */
  async syncMcp(mcpServers) {
    const raw = this.readExistingConfig();
    if (!raw) {
      throw new Error('配置文件不存在');
    }

    const config = JSON.parse(raw);

    // 确保 mcpServers 存在
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // 转换 MCP 配置
    for (const [name, server] of Object.entries(mcpServers)) {
      // Claude 不支持 enabled 字段，如果 enabled=false 则跳过
      if (server.enabled === false) {
        console.log(`    • ${name}: SKIPPED (Claude 不支持禁用字段)`);
        // 如果已存在，删除它
        delete config.mcpServers[name];
        continue;
      }

      const isRemote = server.transport === 'streamable-http' || server.transport === 'sse' || !!server.url;

      if (isRemote) {
        // 远程服务器
        config.mcpServers[name] = {
          type: server.transport === 'sse' ? 'sse' : 'streamable-http',
          url: server.url
        };
      } else {
        // 本地服务器
        config.mcpServers[name] = {
          command: server.command,
          args: server.args || []
        };

        if (server.env && Object.keys(server.env).length > 0) {
          config.mcpServers[name].env = server.env;
        }
      }

      console.log(`    • ${name}: ${isRemote ? config.mcpServers[name].type : 'stdio'}`);
    }

    // 写入配置
    this.writeConfig(JSON.stringify(config, null, 2));
  }

  /**
   * 删除 config.mcpServers 中不在 keepNames 里的条目（force-mcp 重置用）
   * Claude 配置文件: { mcpServers: { name: {...} } }
   */
  async clearMcpExcept(keepNames, { dryRun = false } = {}) {
    const raw = this.readExistingConfig();
    if (!raw) return [];
    const config = JSON.parse(raw);
    const servers = config.mcpServers;
    if (!servers || typeof servers !== 'object') return [];
    const removed = [];
    for (const name of Object.keys(servers)) {
      if (!keepNames.has(name)) {
        removed.push(name);
        if (!dryRun) delete servers[name];
      }
    }
    if (!dryRun && removed.length > 0) {
      this.writeConfig(JSON.stringify(config, null, 2));
    }
    return removed;
  }

  /** 删除指定的 MCP 服务器条目（矩阵 'remove' 值） */
  async deleteMcp(names, { dryRun = false } = {}) {
    const raw = this.readExistingConfig();
    if (!raw) return [];
    const config = JSON.parse(raw);
    const servers = config.mcpServers;
    if (!servers || typeof servers !== 'object') return [];
    const removed = [];
    for (const name of names) {
      if (name in servers) {
        removed.push(name);
        if (!dryRun) delete servers[name];
      }
    }
    if (!dryRun && removed.length > 0) {
      this.writeConfig(JSON.stringify(config, null, 2));
    }
    return removed;
  }

  /**
   * 读取 Claude Code 现有 MCP 服务器及启用状态
   * Claude 不支持 enabled 字段：存在即视为启用（关闭 = 条目被移除）
   */
  getMcpServers() {
    const raw = this.readExistingConfig();
    if (!raw) return [];
    const config = JSON.parse(raw);
    const servers = config.mcpServers || {};
    return Object.entries(servers).map(([name, cfg]) => ({
      name,
      enabled: true,
      config: cfg
    }));
  }
}
