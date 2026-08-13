#!/usr/bin/env node

/**
 * variants-generator.mjs
 * 为不同平台生成 variants 配置
 */

import { ModelVariants } from './model-variants.mjs';

export class VariantsGenerator {
  /**
   * 为 OpenCode 生成 variants
   * @param {string} modelId
   * @param {Object} metadata - 模型元数据
   * @returns {Object|null}
   */
  static generateForOpenCode(modelId, metadata) {
    const baseVariants = ModelVariants.getVariants(modelId);
    
    if (!baseVariants || Object.keys(baseVariants).length === 0) {
      // 如果模型不支持 reasoning，返回 null
      if (!metadata.supportsThinking) {
        return null;
      }
      
      // 生成默认 variants（基于模型族）
      return this.generateDefaultVariants(modelId);
    }
    
    return baseVariants;
  }

  /**
   * 为 Codex 生成 reasoning effort 配置
   * Codex 不使用 variants，而是在 config.toml 中设置 model_reasoning_effort
   * @param {string} modelId
   * @returns {string|null} - "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | null
   */
  static generateForCodex(modelId, metadata) {
    // Codex 通过 opencodex 代理，不需要生成配置
    // 但可以返回推荐的默认 effort
    if (!metadata.supportsThinking) {
      return null;
    }
    
    // 根据模型返回推荐的默认 effort
    if (modelId.includes('sol') || modelId.includes('terra')) {
      return 'xhigh'; // 强推理模型
    } else if (modelId.includes('luna') || modelId.includes('opus')) {
      return 'high';
    } else {
      return 'medium';
    }
  }

  /**
   * 为 Reasonix 生成配置
   * Reasonix 支持 reasoning effort，但配置方式不同
   * @param {string} modelId
   * @returns {Object|null}
   */
  static generateForReasonix(modelId, metadata) {
    // Reasonix 不使用 variants，而是全局设置或运行时指定
    // 返回是否支持 thinking 的标志
    return {
      supportsReasoning: metadata.supportsThinking,
      recommendedEffort: this.generateForCodex(modelId, metadata)
    };
  }

  /**
   * 生成默认 variants（基于模型族）
   */
  static generateDefaultVariants(modelId) {
    const lower = modelId.toLowerCase();
    
    // GPT 系列
    if (lower.includes('gpt')) {
      return {
        none: { reasoningEffort: 'none' },
        low: { reasoningEffort: 'low' },
        medium: { reasoningEffort: 'medium' },
        high: { reasoningEffort: 'high' },
        max: { reasoningEffort: 'max' }
      };
    }
    
    // Claude 系列
    if (lower.includes('claude')) {
      return {
        low: { thinking: { type: 'adaptive', effort: 'low' } },
        medium: { thinking: { type: 'adaptive', effort: 'medium' } },
        high: { thinking: { type: 'adaptive', effort: 'high' } },
        max: { thinking: { type: 'adaptive', effort: 'max' } }
      };
    }
    
    // DeepSeek 系列
    if (lower.includes('deepseek')) {
      return {
        on: { thinking: { type: 'enabled' } },
        off: { thinking: { type: 'disabled' } }
      };
    }
    
    // GLM 系列
    if (lower.includes('glm')) {
      return {
        on: { thinking: { type: 'enabled' } },
        off: { thinking: { type: 'disabled' } }
      };
    }
    
    // Kimi 系列
    if (lower.includes('kimi')) {
      return {
        low: { reasoningEffort: 'low' },
        high: { reasoningEffort: 'high' },
        max: { reasoningEffort: 'max' }
      };
    }
    
    // 默认返回简单的 on/off
    return {
      on: { thinking: { type: 'enabled' } },
      off: { thinking: { type: 'disabled' } }
    };
  }

  /**
   * 判断模型是否需要 variants
   * @param {string} modelId
   * @param {Object} metadata
   * @returns {boolean}
   */
  static needsVariants(modelId, metadata) {
    // 只有支持 thinking 的模型才需要 variants
    if (!metadata.supportsThinking) {
      return false;
    }
    
    // 检查是否有预定义的 variants
    const variants = ModelVariants.getVariants(modelId);
    if (variants && Object.keys(variants).length > 0) {
      return true;
    }
    
    // 根据模型族判断
    const lower = modelId.toLowerCase();
    return (
      lower.includes('gpt') ||
      lower.includes('claude') ||
      lower.includes('deepseek') ||
      lower.includes('glm') ||
      lower.includes('kimi')
    );
  }
}
