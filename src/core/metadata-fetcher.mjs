#!/usr/bin/env node

/**
 * metadata-fetcher.mjs
 * 从 OpenRouter API 获取和缓存模型元数据
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_FILE = path.resolve(__dirname, '../../.cache/openrouter-models.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时

export class MetadataFetcher {
  static cache = null;

  /**
   * 增强模型元数据
   * @param {Array} models - 模型列表
   * @returns {Promise<Array>} 增强后的模型列表
   */
  static async enrich(models) {
    // 加载或获取 OpenRouter 数据
    const orModels = await this.getOpenRouterModels();

    for (const model of models) {
      // 如果已有完整元数据，跳过
      if (model.contextWindow && model.maxOutputTokens) {
        continue;
      }

      // 从 OpenRouter 查找元数据
      const metadata = this.findInOpenRouter(model.modelId, orModels);

      if (metadata) {
        // 合并元数据（优先使用已有的）
        model.contextWindow = model.contextWindow || metadata.context;
        model.maxOutputTokens = model.maxOutputTokens || metadata.output;
        model.supportsVision = model.supportsVision ?? metadata.vision;
        model.supportsThinking = model.supportsThinking ?? metadata.reasoning;
      } else {
        // 使用默认值
        model.contextWindow = model.contextWindow || 200000;
        model.maxOutputTokens = model.maxOutputTokens || 32000;
        model.supportsVision = model.supportsVision ?? false;
        model.supportsThinking = model.supportsThinking ?? false;
      }
    }

    return models;
  }

  /**
   * 获取 OpenRouter 模型数据（优先使用缓存）
   */
  static async getOpenRouterModels() {
    // 检查缓存
    if (this.cache) {
      return this.cache;
    }

    // 检查本地缓存文件
    if (fs.existsSync(CACHE_FILE)) {
      const stat = fs.statSync(CACHE_FILE);
      const age = Date.now() - stat.mtimeMs;

      if (age < CACHE_TTL) {
        try {
          const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
          this.cache = JSON.parse(raw);
          console.log(`✓ 使用缓存的 OpenRouter 数据 (${this.cache.length} 个模型)`);
          return this.cache;
        } catch (error) {
          console.warn('⚠ 缓存文件损坏，重新获取');
        }
      }
    }

    // 从 API 获取
    try {
      console.log('🔄 从 OpenRouter API 获取模型数据...');
      const response = await fetch('https://openrouter.ai/api/v1/models');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const models = data.data || [];

      // 转换为简化格式
      this.cache = models.map(m => ({
        id: m.id,
        name: m.name,
        context: m.context_length,
        output: m.top_provider?.max_completion_tokens,
        vision: m.architecture?.modality?.includes('image') || 
                m.architecture?.input_modalities?.includes('image'),
        reasoning: m.reasoning?.mandatory === true || 
                   m.supported_parameters?.includes('reasoning') ||
                   m.supported_parameters?.includes('include_reasoning')
      }));

      // 保存到缓存
      this.saveCacheFile(this.cache);

      console.log(`✓ OpenRouter 数据已更新: ${this.cache.length} 个模型`);
      return this.cache;

    } catch (error) {
      console.warn('⚠ OpenRouter API 获取失败:', error.message);
      
      // 如果有旧缓存，使用它
      if (fs.existsSync(CACHE_FILE)) {
        try {
          const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
          this.cache = JSON.parse(raw);
          console.log(`✓ 使用旧缓存 (${this.cache.length} 个模型)`);
          return this.cache;
        } catch (e) {
          // ignore
        }
      }

      // 没有缓存，返回空数组
      console.warn('⚠ 无可用的 OpenRouter 数据');
      this.cache = [];
      return this.cache;
    }
  }

  /**
   * 保存缓存文件
   */
  static saveCacheFile(data) {
    try {
      const dir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.warn('⚠ 保存缓存失败:', error.message);
    }
  }

  /**
   * 在 OpenRouter 数据中查找模型（支持模糊匹配）
   */
  static findInOpenRouter(modelId, orModels) {
    if (!orModels || orModels.length === 0) {
      return null;
    }

    // 提取裸模型名（去除 provider 前缀）
    const bare = String(modelId).split('/').pop().toLowerCase();

    // 精确匹配 ID
    let found = orModels.find(m => m.id.toLowerCase() === modelId.toLowerCase());
    if (found) return found;

    // 匹配末尾部分
    found = orModels.find(m => m.id.toLowerCase().endsWith('/' + bare));
    if (found) return found;

    // 标准化匹配（去除特殊字符）
    const norm = bare.replace(/[-_.:]/g, '');
    
    found = orModels.find(m => {
      const idNorm = m.id.toLowerCase().replace(/[-_.:]/g, '');
      return idNorm.includes(norm) || norm.includes(idNorm);
    });
    
    if (found) return found;

    // 按名称模糊匹配
    found = orModels.find(m => {
      const nameLower = m.name.toLowerCase();
      return nameLower.includes(bare) || bare.includes(nameLower.replace(/\s+/g, ''));
    });

    return found || null;
  }

  /**
   * 强制更新缓存
   */
  static async updateCache() {
    // 删除缓存
    if (fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE);
    }
    this.cache = null;

    // 重新获取
    return await this.getOpenRouterModels();
  }
}
