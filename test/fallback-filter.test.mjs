#!/usr/bin/env node
/**
 * fallback-filter.test.mjs
 * 验证降级路径的 disabled provider / disabledModels 过滤
 * 用法: node test/fallback-filter.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigLoader } from '../src/core/config-loader.mjs';

const configPath = path.join(os.homedir(), '.opencodex', 'config.json');

// 断言工具
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

// 场景1: filterDisabledModels 单元测试（不依赖网络）
console.log('=== 场景1: filterDisabledModels 单元测试 ===');
const mockModels = [
  { provider: 'Loadout', modelId: 'deepseek-auto', displayName: 'Loadout/deepseek-auto' },
  { provider: 'Loadout', modelId: 'gpt-5.5', displayName: 'Loadout/gpt-5.5' },
  { provider: 'IMOHUAN', modelId: 'deepseek-v4-pro', displayName: 'IMOHUAN/deepseek-v4-pro' },
  { provider: 'IMOHUAN', modelId: 'deepseek-v4-flash', displayName: 'IMOHUAN/deepseek-v4-flash' },
];
const disabledModels = ['gpt-5.5', 'deepseek-v4-flash'];

// 模拟降级路径: provider 过滤 + disabledModels 过滤
const enabledProviders = ['Loadout']; // IMOHUAN disabled 被跳过
const filtered1 = mockModels.filter(m => enabledProviders.includes(m.provider));
const filtered2 = ConfigLoader.filterDisabledModels(filtered1, disabledModels);

assert(filtered2.length === 1, `IMOHUAN 的两个模型应被 provider 过滤掉 (实际剩 ${filtered2.length})`);
assert(filtered2[0]?.modelId === 'deepseek-auto', `gpt-5.5 应被 disabledModels 过滤，剩 deepseek-auto (实际 ${filtered2[0]?.modelId})`);

// 带前缀匹配: disabledModels 里存 "IMOHUAN/deepseek-v4-pro" 形式
const disabledModelsPrefixed = ['IMOHUAN/deepseek-v4-pro'];
const filtered3 = ConfigLoader.filterDisabledModels(mockModels, disabledModelsPrefixed);
assert(!filtered3.some(m => m.modelId === 'deepseek-v4-pro' && m.provider === 'IMOHUAN'),
  `带前缀 "IMOHUAN/deepseek-v4-pro" 应能匹配到 IMOHUAN/deepseek-v4-pro`);

// 场景2: 真实降级路径（端口指到不存在的，强制走降级）
console.log('\n=== 场景2: 真实降级路径（模拟代理不可用） ===');
// 备份原配置，临时改 port
const raw = fs.readFileSync(configPath, 'utf-8');
const config = JSON.parse(raw);
const origPort = config.port;
config.port = 39999; // 不存在的端口，强制降级
const tmpPath = path.join(os.tmpdir(), 'unifyai-test-config.json');
fs.writeFileSync(tmpPath, JSON.stringify(config));

const result = await ConfigLoader.load(tmpPath);
console.log(`\n结果: ${result.models.length} 个模型`);
const providersInResult = [...new Set(result.models.map(m => m.provider))];
console.log(`出现的 provider: ${providersInResult.join(', ')}`);

// 验证: 不应有 disabled 的 provider
for (const name of ['IMOHUAN', 'xiangsuxingkong', 'deepseek', 'JUHE']) {
  assert(!providersInResult.includes(name), `disabled provider ${name} 不应出现`);
}
assert(providersInResult.includes('Loadout'), 'enabled provider Loadout 应出现');

// 验证: disabledModels 不应出现（仅当模型列表里恰好有这些名字）
const disabledHit = result.models.filter(m => config.disabledModels.includes(m.modelId));
assert(disabledHit.length === 0, `disabledModels 中的模型不应出现 (命中: ${disabledHit.map(m => m.modelId).join(', ') || '无'})`);

// 清理
fs.unlinkSync(tmpPath);
config.port = origPort;

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
process.exit(failed > 0 ? 1 : 0);
