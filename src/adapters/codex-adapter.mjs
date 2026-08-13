#!/usr/bin/env node

/**
 * codex-adapter.mjs
 * Codex CLI 适配器（仅 MCP）
 * 模型配置由 opencodex 代理，只需同步 MCP
 */

import path from 'node:path';
import os from 'node:os';
import { BaseAdapter } from './base-adapter.mjs';
import { tomlToJson, jsonToToml } from '../core/toml-stable.mjs';

export class CodexAdapter extends BaseAdapter {
  constructor() {
    super('Codex');
    this.supportsModels = false; // opencodex 已支持
    this.supportsMcp = true;
  }

  getConfigPath() {
    return path.join(os.homedir(), '.codex', 'config.toml');
  }

  /**
   * 同步 MCP 配置
   */
  async syncMcp(mcpServers) {
    const raw = this.readExistingConfig();
    if (!raw) {
      throw new Error('配置文件不存在');
    }

    // TOML → JSON
    const config = tomlToJson(raw);

    // 确保 mcp_servers 存在
    if (!config.mcp_servers) {
      config.mcp_servers = {};
    }

    // 清理统一格式的垃圾字段
    const UNIFIED_FIELDS = ['transport', 'bearerToken', 'enabled', 'name'];

    // 转换 MCP 配置
    for (const [name, server] of Object.entries(mcpServers)) {
      const isRemote = server.transport === 'streamable-http' || server.transport === 'sse' || !!server.url;

      // 创建或更新 entry
      const entry = config.mcp_servers[name] || {};

      if (isRemote) {
        // 远程服务器
        entry.url = server.url;
        entry.enabled = server.enabled !== false;

        // 清理本地服务器字段
        delete entry.command;
        delete entry.args;
        delete entry.env;

        // 添加 headers（如果需要）
        if (server.bearerToken) {
          if (!entry.headers) {
            entry.headers = {};
          }
          entry.headers.Authorization = `Bearer ${server.bearerToken}`;
        }
      } else {
        // 本地服务器
        entry.command = server.command;
        entry.args = server.args || [];
        entry.enabled = server.enabled !== false;

        // 环境变量
        if (server.env && Object.keys(server.env).length > 0) {
          const cleanEnv = {};
          for (const [k, v] of Object.entries(server.env)) {
            // 过滤掉非环境变量字段
            if (!UNIFIED_FIELDS.includes(k) && v !== null && v !== undefined) {
              cleanEnv[k] = v;
            }
          }
          if (Object.keys(cleanEnv).length > 0) {
            entry.env = cleanEnv;
          }
        }

        // 清理远程服务器字段
        delete entry.url;
        delete entry.headers;
      }

      // 清理统一格式字段
      for (const field of UNIFIED_FIELDS) {
        if (field !== 'enabled') {
          delete entry[field];
        }
      }

      config.mcp_servers[name] = entry;
      console.log(`    • ${name}: ${isRemote ? 'remote' : 'stdio'}`);
    }

    // JSON → TOML
    const toml = jsonToToml(config);
    this.writeConfig(toml);
  }
}
