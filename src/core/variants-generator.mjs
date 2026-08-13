#!/usr/bin/env node

/**
 * variants-generator.mjs
 * 基于 OpenRouter 数据为不同平台生成 variants 配置
 */

export class VariantsGenerator {
  /**
   * 为 OpenCode 生成 variants
   * @param {string} modelId
   * @param {Object} metadata - 模型元数据
   * @returns {Object|null}
   */
  static generateForOpenCode(modelId, metadata) {
    // 如果模型不支持 reasoning，返回 null
    if (!metadata.supportsThinking) {
      return null;
    }

    // 根据模型名称推断 variants 类型
    return this.generateVariantsByModelFamily(modelId);
  }

  /**
   * 为 Codex 生成 reasoning effort 配置
   * @param {string} modelId
   * @param {Object} metadata
   * @returns {string|null} - "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | null
   */
  static generateForCodex(modelId, metadata) {
    if (!metadata.supportsThinking) {
      return null;
    }

    // 根据模型返回推荐的默认 effort
    const lower = modelId.toLowerCase();
    
    if (lower.includes('sol') || lower.includes('terra')) {
      return 'xhigh'; // 强推理模型
    } else if (lower.includes('luna') || lower.includes('opus')) {
      return 'high';
    } else {
      return 'medium';
    }
  }

  /**
   * 为 Reasonix 生成配置
   * @param {string} modelId
   * @param {Object} metadata
   * @returns {Object|null}
   */
  static generateForReasonix(modelId, metadata) {
    return {
      supportsReasoning: metadata.supportsThinking,
      recommendedEffort: this.generateForCodex(modelId, metadata)
    };
  }

  /**
   * 根据模型族生成 variants
   */
  static generateVariantsByModelFamily(modelId) {
    const lower = modelId.toLowerCase();

    // GPT 系列 (reasoning effort)
    if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3')) {
      return {
        none: { reasoningEffort: 'none' },
        low: { reasoningEffort: 'low' },
        medium: { reasoningEffort: 'medium' },
        high: { reasoningEffort: 'high' },
        xhigh: { reasoningEffort: 'xhigh' },
        max: { reasoningEffort: 'max' }
      };
    }

    // Claude 系列 (adaptive thinking)
    if (lower.includes('claude')) {
      return {
        low: { thinking: { type: 'adaptive', effort: 'low' } },
        medium: { thinking: { type: 'adaptive', effort: 'medium' } },
        high: { thinking: { type: 'adaptive', effort: 'high' } },
        xhigh: { thinking: { type: 'adaptive', effort: 'xhigh' } },
        max: { thinking: { type: 'adaptive', effort: 'max' } }
      };
    }

    // DeepSeek 系列 (on/off)
    if (lower.includes('deepseek')) {
      return {
        on: { thinking: { type: 'enabled' } },
        off: { thinking: { type: 'disabled' } }
      };
    }

    // GLM 系列 (on/off)
    if (lower.includes('glm')) {
      return {
        on: { thinking: { type: 'enabled' } },
        off: { thinking: { type: 'disabled' } }
      };
    }

    // Kimi 系列 (reasoning effort)
    if (lower.includes('kimi') || lower.includes('moonshot')) {
      return {
        low: { reasoningEffort: 'low' },
        high: { reasoningEffort: 'high' },
        max: { reasoningEffort: 'max' }
      };
    }

    // Qwen 系列 (on/off)
    if (lower.includes('qwen') || lower.includes('qwq')) {
      return {
        on: { thinking: { type: 'enabled' } },
        off: { thinking: { type: 'disabled' } }
      };
    }

    // Gemini 系列 (experimental)
    if (lower.includes('gemini')) {
      return {
        low: { thinking: { type: 'adaptive', effort: 'low' } },
        medium: { thinking: { type: 'adaptive', effort: 'medium' } },
        high: { thinking: { type: 'adaptive', effort: 'high' } }
      };
    }

    // 默认：简单的 on/off
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
    return metadata.supportsThinking === true;
  }
}
