#!/usr/bin/env node

/**
 * model-variants.mjs
 * 模型 variants 配置工具
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ModelVariants {
  static variantsConfig = null;

  /**
   * 加载 variants 配置
   */
  static loadVariants() {
    if (this.variantsConfig) {
      return this.variantsConfig;
    }

    try {
      const configPath = path.resolve(__dirname, '../../config/model-variants.json');
      if (!fs.existsSync(configPath)) {
        console.warn('⚠ model-variants.json 不存在，使用空配置');
        this.variantsConfig = {};
        return this.variantsConfig;
      }
      const raw = fs.readFileSync(configPath, 'utf-8');
      this.variantsConfig = JSON.parse(raw);
      return this.variantsConfig;
    } catch (error) {
      console.warn('⚠ 加载 model-variants.json 失败:', error.message);
      this.variantsConfig = {};
      return this.variantsConfig;
    }
  }

  /**
   * 获取模型的 variants 配置
   * @param {string} modelId - 模型 ID
   * @returns {Object|null}
   */
  static getVariants(modelId) {
    const config = this.loadVariants();

    // 精确匹配
    if (config[modelId]) {
      return config[modelId];
    }

    // 模糊匹配（去除版本号等）
    const norm = modelId.toLowerCase().replace(/[-_.:]/g, '');

    for (const [key, variants] of Object.entries(config)) {
      const keyNorm = key.toLowerCase().replace(/[-_.:]/g, '');
      if (norm === keyNorm || norm.includes(keyNorm) || keyNorm.includes(norm)) {
        return variants;
      }
    }

    return null;
  }

  /**
   * 判断模型是否支持 reasoning
   * @param {string} modelId
   * @returns {boolean}
   */
  static supportsReasoning(modelId) {
    const variants = this.getVariants(modelId);
    if (!variants || Object.keys(variants).length === 0) {
      return false;
    }

    // 检查是否有 reasoningEffort 或 thinking
    for (const variant of Object.values(variants)) {
      if (variant.reasoningEffort || variant.thinking) {
        return true;
      }
    }

    return false;
  }
}
