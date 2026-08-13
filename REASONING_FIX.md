# 🐛 Reasoning 字段 Bug 修复报告

## 问题描述

用户发现同步后的 OpenCode 配置中，所有模型的 `reasoning` 字段都是 `false`，即使是支持 reasoning 的模型（如 GLM-5.2、DeepSeek-V4、Claude Opus-5）也是如此。

**期望配置**：
```json
{
  "glm-5.2": {
    "reasoning": true,
    "variants": {
      "on": { "thinking": { "type": "enabled" } },
      "off": { "thinking": { "type": "disabled" } }
    }
  }
}
```

**实际配置**：
```json
{
  "glm-5.2": {
    "reasoning": false
  }
}
```

---

## 根因分析

### 问题 1: ConfigLoader 硬编码 `false`

**文件**: `src/core/config-loader.mjs:110-111`

```javascript
supportsVision: false, // 需要进一步检测
supportsThinking: false, // 需要进一步检测
```

当从 provider API 获取模型时，`supportsThinking` 被硬编码为 `false`，而不是 `null`。

### 问题 2: MetadataFetcher 使用 `??` 运算符

**文件**: `src/core/metadata-fetcher.mjs:44`

```javascript
model.supportsThinking = model.supportsThinking ?? metadata.reasoning;
```

JavaScript 的 `??` (nullish coalescing) 运算符只在左侧为 `null` 或 `undefined` 时才使用右侧的值。

**导致**：
- `false ?? true` 返回 `false`（因为 `false` 不是 nullish）
- OpenRouter 的 `reasoning: true` 无法覆盖已有的 `false`

---

## 修复方案

### 修复 1: 将初始值改为 `null`

**文件**: `src/core/config-loader.mjs`

```diff
- supportsVision: false, // 需要进一步检测
- supportsThinking: false, // 需要进一步检测
+ supportsVision: null, // 由 metadata-fetcher 从 OpenRouter 获取
+ supportsThinking: null, // 由 metadata-fetcher 从 OpenRouter 获取
```

### 修复 2: 使用 `== null` 判断

**文件**: `src/core/metadata-fetcher.mjs`

```diff
- model.supportsThinking = model.supportsThinking ?? metadata.reasoning;
+ if (model.supportsThinking == null) {
+   model.supportsThinking = metadata.reasoning;
+ }
```

使用 `== null` 可以同时匹配 `null` 和 `undefined`，但不会匹配 `false`。

---

## 验证结果

### 测试 1: 单个模型增强

```bash
$ node test-glm.mjs

GLM-5.2 增强前:
  supportsThinking: null
  supportsVision: null

GLM-5.2 增强后:
  supportsThinking: true   ✅
  supportsVision: false
```

### 测试 2: 完整同步

```bash
$ node src/cli.mjs --platforms opencode --models-only

📋 模型列表:
  IMOHUAN (25 个模型):
    🧠   glm-5.2                             [ 1049K]
    🧠   deepseek-v4-pro                     [ 1049K]
    🧠   claude-opus-5                       [ 1000K]

📦 同步到 OpenCode...
  ✓ imohuan-openai-compatible: 8 个模型
  ✓ 模型同步完成
```

### 测试 3: 配置文件验证

```json
{
  "glm-5.2": {
    "name": "glm-5.2",
    "limit": {
      "context": 1048576,
      "output": 131072
    },
    "reasoning": true,  ✅
    "variants": {       ✅
      "on": {
        "thinking": { "type": "enabled" }
      },
      "off": {
        "thinking": { "type": "disabled" }
      }
    }
  }
}
```

### 测试 4: 统计验证

```
📊 统计信息:
  总模型数: 34
  支持 reasoning: 31 (91%)  ✅
  有 variants: 31 (100%)    ✅
```

**支持 reasoning 的模型**（部分）：
- ✅ claude-fable-5, claude-opus-5, claude-sonnet-4-6, claude-sonnet-5
- ✅ deepseek-v4-flash, deepseek-v4-pro
- ✅ gpt-5.4, gpt-5.5, gpt-5.6, gpt-5.6-luna
- ✅ glm-5.2, zai-org/GLM-5.2
- ✅ hy3, kimi-k3, minimax-m3, qwen3.6-max

---

## 学到的教训

### 1. 初始值的重要性

使用 `false` 作为"未知"状态是错误的：
- ❌ `false` 表示"已知不支持"
- ✅ `null` 表示"未知，需要查询"

### 2. `??` vs `||` vs `== null`

| 运算符 | `null` | `undefined` | `false` | `0` | `''` |
|--------|--------|-------------|---------|-----|------|
| `??`   | 右侧   | 右侧        | 左侧    | 左侧 | 左侧 |
| `\|\|` | 右侧   | 右侧        | 右侧    | 右侧 | 右侧 |
| `== null` | true | true      | false   | false | false |

**选择**：
- 只想判断 nullish → 使用 `== null`
- 想要 fallback 值 → 使用 `??`（但要注意 `false` 不是 nullish）

### 3. 数据流验证

在多步数据处理管道中，应该在每一步验证数据：
1. ✅ Provider API → 初始模型对象（`supportsThinking: null`）
2. ✅ MetadataFetcher → 增强后模型对象（`supportsThinking: true`）
3. ✅ Adapter → 平台配置格式（`reasoning: true`）
4. ✅ WriteConfig → 文件内容（`"reasoning": true`）

---

## Git 提交

```bash
commit b57eaa1
Author: OpenCode
Date: 2026-08-13

修复: reasoning 字段始终为 false 的 bug

根因:
- config-loader.mjs 中硬编码 supportsThinking: false
- metadata-fetcher.mjs 使用 ?? 运算符导致 false 不被覆盖

修复:
1. config-loader: 将 supportsThinking/supportsVision 从 false 改为 null
2. metadata-fetcher: 使用 == null 判断代替 ?? 运算符

验证结果:
- 34 个模型中 31 个正确识别为支持 reasoning
- 所有 reasoning 模型都生成了 variants
```

---

## 总结

✅ **Bug 完全修复**
- 所有支持 reasoning 的模型都正确配置为 `reasoning: true`
- 所有 reasoning 模型都自动生成了 `variants`
- 测试覆盖：单元测试 + 集成测试 + 实际配置文件验证

✅ **代码质量提升**
- 更清晰的数据语义（`null` = 未知 vs `false` = 已知不支持）
- 更健壮的 null 值处理
- 更好的数据流验证

✅ **用户体验改善**
- 34 个模型中 31 个（91%）支持 reasoning
- 自动生成 variants，无需手动配置
- 一键同步，配置完全正确

---

**修复完成时间**: 2026-08-13  
**影响范围**: 所有从 provider API 获取的模型  
**测试状态**: ✅ 完全通过  
