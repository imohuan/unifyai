#!/usr/bin/env node

/**
 * metadata-fetcher.mjs
 * 从 OpenRouter API 获取和缓存模型元数据
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.join(os.homedir(), '.unifyai', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'openrouter-models.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时

export class MetadataFetcher {
  static cache = null;

  /**
   * 增强模型元数据
   * @param {Array} models - 模型列表
   * @param {Array} [orModels] - 可选的 OpenRouter 数据（测试注入用）
   * @param {Object} [options] - 附加选项
   * @param {boolean} [options.visionOverride] - 强制把所有模型标记为支持视觉
   * @returns {Promise<Array>} 增强后的模型列表
   */
  static async enrich(models, orModels, options = {}) {
    const { visionOverride = false } = options;

    // 加载或获取 OpenRouter 数据（未注入时自动获取）
    if (!orModels) {
      orModels = await this.getOpenRouterModels();
    }

    for (const model of models) {
      // 从 OpenRouter 查找元数据
      const metadata = this.findInOpenRouter(model.modelId, orModels);

      if (metadata) {
        // 合并元数据（只在未设置时使用 OpenRouter 数据）
        if (model.contextWindow == null) {
          model.contextWindow = metadata.context;
        }
        if (model.maxOutputTokens == null) {
          model.maxOutputTokens = metadata.output;
        }
        if (model.supportsVision == null) {
          model.supportsVision = metadata.vision;
        }
        if (model.supportsThinking == null) {
          model.supportsThinking = metadata.reasoning;
        }
        // 手动开启视觉（--enable-vision）优先于 OpenRouter 数据
        if (visionOverride) {
          model.supportsVision = true;
        }
      } else {
        // 使用默认值（只在未设置时）
        if (model.contextWindow == null) {
          model.contextWindow = 200000;
        }
        if (model.maxOutputTokens == null) {
          model.maxOutputTokens = 32000;
        }
        if (model.supportsVision == null) {
          model.supportsVision = false;
        }
        if (model.supportsThinking == null) {
          model.supportsThinking = false;
        }
        // 手动开启视觉（--enable-vision）优先于默认值
        if (visionOverride) {
          model.supportsVision = true;
        }
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

    // 1. 精确匹配完整 ID
    let found = orModels.find(m => m.id.toLowerCase() === modelId.toLowerCase());
    if (found) return found;

    // 2. 匹配末尾部分（裸名匹配任意 provider 前缀）
    found = orModels.find(m => m.id.toLowerCase().endsWith('/' + bare));
    if (found) return found;

    // 3. 标准化匹配（去除特殊字符，双向包含判断）
    found = this.matchByNormalized(bare, orModels);
    if (found) return found;

    // 4. 版本后缀剥离匹配：deepseek-v4-flash-ga-260731 → deepseek-v4-flash
    //    先尝试去掉 "-ga-<日期>" 形式的后缀
    const gaMatch = bare.match(/^(.+?)-ga-\d+$/);
    if (gaMatch) {
      const baseName = gaMatch[1];
      // 优先匹配 <base>-latest：带版本日期的模型通常对应最新发布
      found = orModels.find(m => m.id.toLowerCase().endsWith('/' + baseName + '-latest'));
      if (found) return found;

      found = orModels.find(m => m.id.toLowerCase().endsWith('/' + baseName));
      if (found) return found;
      found = this.matchByNormalized(baseName, orModels);
      if (found) return found;
    }

    // 5. 依次剥离尾部版本/日期片段，取最长的匹配结果
    found = this.matchByStrippingVersionSuffix(bare, orModels);
    if (found) return found;

    // 6. 按名称模糊匹配（只有完整裸名包含关系，不做反向包含，避免别名错配）
    found = orModels.find(m => {
      const nameLower = m.name.toLowerCase();
      return nameLower.includes(bare);
    });

    return found || null;
  }

  /**
   * 标准化匹配（去除特殊字符，双向包含判断）
   */
  static matchByNormalized(bare, orModels) {
    const norm = bare.replace(/[-_.:]/g, '');

    return orModels.find(m => {
      const idNorm = m.id.toLowerCase().replace(/[-_.:]/g, '');
      return idNorm.includes(norm) || norm.includes(idNorm);
    });
  }

  /**
   * 依次剥离尾部版本/日期片段后匹配
   * 例: deepseek-v4-flash-ga-260731 → deepseek-v4-flash-ga → deepseek-v4-flash
   * 只做"裸名是 OpenRouter ID 后缀的一部分"的单向匹配，避免错配
   */
  static matchByStrippingVersionSuffix(bare, orModels) {
    const parts = bare.split('-');
    // 从尾部依次剥离，至少保留 2 段
    for (let i = parts.length - 1; i >= 2; i--) {
      const candidate = parts.slice(0, i).join('-');

      // 优先匹配 <candidate>-latest
      let found = orModels.find(m => m.id.toLowerCase().endsWith('/' + candidate + '-latest'));
      if (found) return found;

      // 候选名必须能作为 OpenRouter ID 的后缀（provider/... 前缀）
      found = orModels.find(m => m.id.toLowerCase().endsWith('/' + candidate));
      if (found) return found;

      // 标准化后单向包含匹配
      const norm = candidate.replace(/[-_.:]/g, '');
      if (norm.length < 4) continue;
      found = orModels.find(m => {
        const idNorm = m.id.toLowerCase().replace(/[-_.:]/g, '');
        return idNorm.includes(norm);
      });
      if (found) return found;
    }

    return null;
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
