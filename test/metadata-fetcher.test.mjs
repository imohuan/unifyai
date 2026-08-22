import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetadataFetcher } from '../src/core/metadata-fetcher.mjs';

// 模拟 OpenRouter 缓存数据（与真实缓存结构一致）
const orModels = [
  { id: 'deepseek/deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731', context: 1310720, output: 384000, vision: false, reasoning: false },
  { id: 'deepseek/deepseek-v4-flash-latest', name: 'DeepSeek V4 Flash Latest', context: 1310720, output: 1048576, vision: false, reasoning: true },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', context: 1048576, output: 384000, vision: false, reasoning: true },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', context: 1048576, output: 384000, vision: false, reasoning: true },
  { id: 'openai/gpt-4o', name: 'GPT-4o', context: 128000, output: 16384, vision: true, reasoning: false }
];

test('精确匹配：deepseek-v4-flash-0731 匹配到同名 OpenRouter 条目', () => {
  const found = MetadataFetcher.findInOpenRouter('deepseek-v4-flash-0731', orModels);
  assert.ok(found);
  assert.equal(found.id, 'deepseek/deepseek-v4-flash-0731');
  assert.equal(found.context, 1310720);
});

test('版本后缀匹配：deepseek-v4-flash-ga-260731 应匹配到 flash-latest', () => {
  const found = MetadataFetcher.findInOpenRouter('deepseek-v4-flash-ga-260731', orModels);
  assert.ok(found, '应该匹配到 OpenRouter 条目');
  assert.equal(found.context, 1310720);
  assert.equal(found.output, 1048576);
});

test('版本后缀匹配：deepseek-v4-pro-0813 应匹配到 deepseek-v4-pro', () => {
  const found = MetadataFetcher.findInOpenRouter('deepseek-v4-pro-0813', orModels);
  assert.ok(found, '应该匹配到 OpenRouter 条目');
  assert.equal(found.context, 1048576);
});

test('带 provider 前缀的完整 ID 也能匹配（IMOHUAN/deepseek-v4-pro）', () => {
  const found = MetadataFetcher.findInOpenRouter('IMOHUAN/deepseek-v4-pro', orModels);
  assert.ok(found);
  assert.equal(found.id, 'deepseek/deepseek-v4-pro');
});

test('enrich 使用 visionOverride 覆盖 supportsVision', async () => {
  const models = [
    { provider: 'Loadout', modelId: 'deepseek-v4-flash-ga-260731', contextWindow: null, maxOutputTokens: null, supportsVision: null, supportsThinking: null }
  ];
  const enriched = await MetadataFetcher.enrich(models, orModels, { visionOverride: true });
  assert.equal(enriched[0].supportsVision, true);
  // 元数据仍然来自 OpenRouter
  assert.equal(enriched[0].contextWindow, 1310720);
  assert.equal(enriched[0].maxOutputTokens, 1048576);
});

test('enrich 不传 visionOverride 时不改变已有 supportsVision', async () => {
  const models = [
    { provider: 'Loadout', modelId: 'gpt-4o', contextWindow: null, maxOutputTokens: null, supportsVision: null, supportsThinking: null }
  ];
  const enriched = await MetadataFetcher.enrich(models, orModels);
  assert.equal(enriched[0].supportsVision, true); // OpenRouter 数据为 true
});

test('enrich 不传 visionOverride 时默认保持 OpenRouter 数据（vision=false）', async () => {
  const models = [
    { provider: 'Loadout', modelId: 'deepseek-v4-flash-0731', contextWindow: null, maxOutputTokens: null, supportsVision: null, supportsThinking: null }
  ];
  const enriched = await MetadataFetcher.enrich(models, orModels);
  assert.equal(enriched[0].supportsVision, false);
  assert.equal(enriched[0].contextWindow, 1310720);
});

test('enrich 中显式配置的 contextWindow 优先于 OpenRouter 数据', async () => {
  const models = [
    { provider: 'Loadout', modelId: 'deepseek-v4-flash-0731', contextWindow: 999999, maxOutputTokens: null, supportsVision: null, supportsThinking: null }
  ];
  const enriched = await MetadataFetcher.enrich(models, orModels);
  assert.equal(enriched[0].contextWindow, 999999);
  assert.equal(enriched[0].maxOutputTokens, 384000);
});
