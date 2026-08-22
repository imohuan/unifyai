import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetadataFetcher } from '../src/core/metadata-fetcher.mjs';

const orModels = [
  { id: 'deepseek/deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731', context: 1310720, output: 384000, vision: false, reasoning: false }
];

test('enrich visionOverride 未传时匹配不到 OpenRouter 数据则使用默认值 false', async () => {
  const models = [
    { provider: 'Loadout', modelId: 'unknown-model-xyz', contextWindow: null, maxOutputTokens: null, supportsVision: null, supportsThinking: null }
  ];
  const enriched = await MetadataFetcher.enrich(models, orModels);
  assert.equal(enriched[0].supportsVision, false);
  assert.equal(enriched[0].contextWindow, 200000);
});

test('enrich 无 OpenRouter 数据且 visionOverride=true 时强制开启视觉', async () => {
  const models = [
    { provider: 'Loadout', modelId: 'unknown-model-xyz', contextWindow: null, maxOutputTokens: null, supportsVision: null, supportsThinking: null }
  ];
  const enriched = await MetadataFetcher.enrich(models, [], { visionOverride: true });
  assert.equal(enriched[0].supportsVision, true);
});
