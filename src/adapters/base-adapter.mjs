#!/usr/bin/env node

/**
 * base-adapter.mjs
 * 平台适配器基类
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class BaseAdapter {
  constructor(platformName, platformId) {
    this.platformName = platformName;
    // 平台标识（用于 CLI 参数），默认取 name 小写去空格；特例可显式传入
    this.platformId = platformId || platformName.toLowerCase().replace(/\s+/g, '');
    this.supportsModels = false;
    this.supportsMcp = false;
    // 能力状态：'supported' | 'not_supported' | 'not_implemented'
    this.modelStatus = 'not_supported';
    this.mcpStatus = 'not_supported';
    // 配置文件格式：'json' | 'jsonc' | 'toml' | 'yaml'
    this.configFormat = 'json';
  }

  /**
   * 获取平台结构化信息（供 UI 消费）
   * @returns {Object}
   */
  getInfo() {
    const home = os.homedir();
    const absPath = this.getConfigPath();
    // 把绝对路径里的家目录替换为 ~，并把分隔符统一为 /
    const displayPath = absPath.startsWith(home)
      ? '~' + absPath.slice(home.length).replace(/\\/g, '/')
      : absPath;

    return {
      id: this.platformId,
      name: this.platformName,
      supportsModels: this.supportsModels,
      modelStatus: this.modelStatus,
      supportsMcp: this.supportsMcp,
      mcpStatus: this.mcpStatus,
      configPath: displayPath,
      configFormat: this.configFormat
    };
  }

  /**
   * 读取目标平台现有的 MCP 服务器列表及启用状态（供 --list-mcp 使用）
   * 默认未实现返回 null（表示该平台暂不支持读取），支持读取的平台覆写
   * @returns {Array<{name: string, enabled: boolean}>|null}
   */
  getMcpServers() {
    return null;
  }

  /**
   * 获取配置文件路径
   * @returns {string}
   */
  getConfigPath() {
    throw new Error(`${this.platformName}: Must implement getConfigPath()`);
  }

  /**
   * 同步模型配置
   * @param {Array} models - 增强后的模型列表
   */
  async syncModels(models) {
    if (!this.supportsModels) {
      console.log(`  ⊘ ${this.platformName} 不支持模型同步`);
      return;
    }
    throw new Error(`${this.platformName}: Must implement syncModels()`);
  }

  /**
   * 同步 MCP 配置
   * @param {Object} mcpServers - MCP 服务器配置
   */
  async syncMcp(mcpServers) {
    if (!this.supportsMcp) {
      console.log(`  ⊘ ${this.platformName} 不支持 MCP 同步`);
      return;
    }
    throw new Error(`${this.platformName}: Must implement syncMcp()`);
  }

  /**
   * 删除目标平台 MCP 集合中不在 keepNames 列表里的条目（force-mcp 重置用）
   * @param {Set<string>} keepNames - 要保留的服务器名集合
   * @param {Object} [opts] - { dryRun: true 仅打印计划不写入 }
   * @returns {string[]} 被删除的服务器名列表
   */
  async clearMcpExcept(keepNames, { dryRun = false } = {}) {
    if (!this.supportsMcp) return [];
    throw new Error(`${this.platformName}: Must implement clearMcpExcept()`);
  }

  /**
   * 删除目标平台 MCP 集合中指定的条目（矩阵 'remove' 值用）
   * @param {string[]} names - 要删除的服务器名
   * @param {Object} [opts] - { dryRun: true 仅打印计划不写入 }
   * @returns {string[]} 实际删除的服务器名列表
   */
  async deleteMcp(names, { dryRun = false } = {}) {
    if (!this.supportsMcp) return [];
    throw new Error(`${this.platformName}: Must implement deleteMcp()`);
  }

  /**
   * 执行完整同步
   * @param {Object} config - 配置对象
   * @param {Array} config.models - 模型列表
   * @param {Object} config.mcp - MCP 配置
   * @param {Object} options - 同步选项
   */
  async sync(config, options = {}) {
    const { models, mcp } = config;
    const { modelsOnly = false, mcpOnly = false } = options;

    console.log(`\n📦 同步到 ${this.platformName}...`);
    // 输出完整的配置地址详情
    const configPath = this.getConfigPath();
    console.log(`  📍 配置文件完整路径: ${configPath}`);

    const exists = fs.existsSync(configPath);

    if (!exists) {
      console.warn(`  ⚠ 配置文件不存在: ${configPath}`);
      console.warn(`  跳过同步`);
      return;
    }

    // 备份
    await this.backup();

    try {
      // 同步模型
      if (!mcpOnly && this.supportsModels && models && models.length > 0) {
        console.log(`  → 同步模型配置 (${models.length} 个)`);
        await this.syncModels(models);
        console.log(`  ✓ 模型同步完成`);
      }

      // 同步 MCP
      if (!modelsOnly && this.supportsMcp && mcp && Object.keys(mcp).length > 0) {
        console.log(`  → 同步 MCP 配置 (${Object.keys(mcp).length} 个)`);
        await this.syncMcp(mcp);
        console.log(`  ✓ MCP 同步完成`);
      }

      console.log(`  ✓ ${this.platformName} 同步成功`);
    } catch (error) {
      console.error(`  ✗ ${this.platformName} 同步失败:`, error.message);
      throw error;
    }
  }

  /**
   * 备份配置文件
   */
  async backup() {
    const configPath = this.getConfigPath();

    if (!fs.existsSync(configPath)) {
      return;
    }

    const timestamp = Date.now();
    const backupPath = `${configPath}.bak-${timestamp}`;

    try {
      fs.copyFileSync(configPath, backupPath);
      console.log(`  💾 备份: ${path.basename(backupPath)}`);
    } catch (error) {
      console.warn(`  ⚠ 备份失败:`, error.message);
    }
  }

  /**
   * 读取现有配置文件
   * @returns {string|null}
   */
  readExistingConfig() {
    const configPath = this.getConfigPath();

    if (!fs.existsSync(configPath)) {
      return null;
    }

    return fs.readFileSync(configPath, 'utf-8');
  }

  /**
   * 写入配置文件
   * @param {string} content
   */
  writeConfig(content) {
    const configPath = this.getConfigPath();
    const dir = path.dirname(configPath);

    // 确保目录存在
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(configPath, content, 'utf-8');
  }

  /**
   * 解析 JSONC（支持注释和 trailing commas）
   * @param {string} text
   * @returns {Object}
   */
  parseJsonc(text) {
    let stripped = '';
    let i = 0;
    let inString = false;
    let escaped = false;

    while (i < text.length) {
      const ch = text[i];

      if (escaped) {
        stripped += ch;
        escaped = false;
        i++;
        continue;
      }

      if (ch === '\\' && inString) {
        stripped += ch;
        escaped = true;
        i++;
        continue;
      }

      if (ch === '"') {
        stripped += ch;
        inString = !inString;
        i++;
        continue;
      }

      if (!inString) {
        // 移除单行注释 //
        if (ch === '/' && text[i + 1] === '/') {
          i += 2;
          while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
          continue;
        }
        // 移除多行注释 /* */
        if (ch === '/' && text[i + 1] === '*') {
          i += 2;
          while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
          i += 2;
          continue;
        }
      }

      stripped += ch;
      i++;
    }

    // 移除 trailing commas
    stripped = stripped.replace(/,\s*\]/g, ']').replace(/,\s*\}/g, '}');

    return JSON.parse(stripped);
  }
}
