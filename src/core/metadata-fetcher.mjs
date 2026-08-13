#!/usr/bin/env node

/**
 * metadata-fetcher.mjs
 * 获取和增强模型元数据
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class MetadataFetcher {
  static knownModels = null;
  static openRouterCache = null;

  /**
   * 增强模型元数据
   * @param {Array} models - 模型列表
   * @returns {Promise<Array>} 增强后的模型列表
   */
  static async enrich(models) {
    // 加载已知模型
    if (!this.knownModels) {
      this.knownModels = this.loadKnownModels();
    }

    // 获取 OpenRouter 索引（异步，不阻塞）
    if (!this.openRouterCache) {
      this.openRouterCache = this.fetchOpenRouterIndex().catch(() => ({}));
    }
    const orIndex = await this.openRouterCache;

    for (const model of models) {
      // 如果已有完整元数据，跳过
      if (model.contextWindow && model.maxOutputTokens) {
        continue;
      }

      // 查找元数据
      const metadata =
        this.findInKnownModels(model.modelId, this.knownModels) ||
        this.findInOpenRouter(model.modelId, orIndex) ||
        this.getDefaultMetadata();

      // 合并元数据（优先使用已有的）
      model.contextWindow = model.contextWindow || metadata.context || 200000;
      model.maxOutputTokens = model.maxOutputTokens || metadata.output || 32000;
      model.supportsVision = model.supportsVision ?? metadata.vision ?? false;
      model.supportsThinking = model.supportsThinking ?? metadata.thinking ?? false;
    }

    return models;
  }

  /**
   * 加载已知模型配置
   */
  static loadKnownModels() {
    try {
      const configPath = path.resolve(__dirname, '../../config/known-models.json');
      if (!fs.existsSync(configPath)) {
        console.warn('⚠ known-models.json 不存在，使用空配置');
        return {};
      }
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    } catch (error) {
      console.warn('⚠ 加载 known-models.json 失败:', error.message);
      return {};
    }
  }

  /**
   * 从 OpenRouter 获取模型索引
   */
  static async fetchOpenRouterIndex() {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const index = {};

      for (const model of data.data || []) {
        const id = model.id.split('/').pop();
        index[id] = {
          context: model.context_length,
          output: model.top_provider?.max_completion_tokens,
          vision: model.architecture?.modality === 'multimodal',
          thinking: false // OpenRouter 暂不提供此信息
        };
      }

      console.log(`✓ OpenRouter 索引: ${Object.keys(index).length} 个模型`);
      return index;
    } catch (error) {
      console.warn('⚠ OpenRouter 索引获取失败:', error.message);
      return {};
    }
  }

  /**
   * 在已知模型中查找（支持模糊匹配）
   */
  static findInKnownModels(modelId, knownModels) {
    // 精确匹配
    if (knownModels[modelId]) {
      return knownModels[modelId];
    }

    // 标准化名称（去除特殊字符）
    const norm = modelId.toLowerCase().replace(/[-_.:]/g, '');

    for (const [key, metadata] of Object.entries(knownModels)) {
      const keyNorm = key.toLowerCase().replace(/[-_.:]/g, '');

      // 完全匹配
      if (norm === keyNorm) {
        return metadata;
      }

      // 包含匹配
      if (norm.includes(keyNorm) || keyNorm.includes(norm)) {
        return metadata;
      }
    }

    // 分词匹配（例如 "deepseek-v4-pro" 匹配 "deepseek", "v4", "pro"）
    for (const [key, metadata] of Object.entries(knownModels)) {
      const keyNorm = key.toLowerCase().replace(/[-_.:]/g, '');
      const parts = keyNorm.split(/(?<=\D)(?=\d)|(?<=\d)(?=\D)/).filter(p => p.length >= 2);

      if (parts.length === 0) continue;

      if (parts.every(p => norm.includes(p))) {
        return metadata;
      }
    }

    return null;
  }

  /**
   * 在 OpenRouter 索引中查找
   */
  static findInOpenRouter(modelId, orIndex) {
    if (!orIndex || Object.keys(orIndex).length === 0) {
      return null;
    }

    // 提取裸模型名（去除 provider 前缀）
    const bare = String(modelId).split('/').pop().toLowerCase();

    // 精确匹配
    if (orIndex[bare]) {
      return orIndex[bare];
    }

    // 标准化匹配
    const norm = bare.replace(/[-_.:]/g, '');

    for (const [key, metadata] of Object.entries(orIndex)) {
      const keyNorm = key.toLowerCase().replace(/[-_.:]/g, '');
      if (norm === keyNorm) {
        return metadata;
      }
    }

    return null;
  }

  /**
   * 获取默认元数据
   */
  static getDefaultMetadata() {
    return {
      context: 200000,
      output: 32000,
      vision: false,
      thinking: false
    };
  }
}
