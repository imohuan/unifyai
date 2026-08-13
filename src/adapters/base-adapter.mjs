#!/usr/bin/env node

/**
 * base-adapter.mjs
 * 平台适配器基类
 */

import fs from 'node:fs';
import path from 'node:path';

export class BaseAdapter {
  constructor(platformName) {
    this.platformName = platformName;
    this.supportsModels = false;
    this.supportsMcp = false;
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

    // 检查配置文件是否存在
    const configPath = this.getConfigPath();
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
