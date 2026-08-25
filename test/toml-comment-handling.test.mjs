import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { tomlToJson, jsonToToml } from '../src/core/toml-array-tables.mjs';

const testDir = path.join(os.tmpdir(), 'toml-comment-test');
const testConfigPath = path.join(testDir, 'config.toml');

function setupTest() {
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
}

function cleanupTest() {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

// 测试带注释的配置文件解析
test('TOML Parser - 正确解析带注释的配置', () => {
  const tomlWithComments = `config_version = 5   # schema marker for diagnostics; old versions may ignore it
default_model = "deepseek-v4-pro"   # default model
credentials_store = "auto"   # legacy compatibility

[ui]
theme = "auto"   # auto|dark|light; CLI colors only
show_reasoning = true   # CLI: show thinking text by default

[[providers]]
name = "loadout"
kind = "openai"
api_key_env = "LOADOUT_API_KEY"   # environment variable for API key
models = [ "model1", "model2" ]   # available models
`;

  const json = tomlToJson(tomlWithComments);
  
  // 验证顶层字段（注释应被移除）
  assert.strictEqual(json.config_version, 5, 'config_version 应该是整数 5');
  assert.strictEqual(json.default_model, 'deepseek-v4-pro', 'default_model 应该是字符串');
  assert.strictEqual(json.credentials_store, 'auto', 'credentials_store 应该是字符串');
  
  // 验证 section 字段
  assert.strictEqual(json.ui.theme, 'auto', 'ui.theme 应该是字符串');
  assert.strictEqual(json.ui.show_reasoning, true, 'ui.show_reasoning 应该是布尔值');
  
  // 验证 provider 字段
  assert.ok(Array.isArray(json.providers), 'providers 应该是数组');
  assert.strictEqual(json.providers[0].name, 'loadout', 'provider name 应该正确');
  assert.strictEqual(json.providers[0].api_key_env, 'LOADOUT_API_KEY', 'api_key_env 应该正确');
  assert.deepStrictEqual(json.providers[0].models, ['model1', 'model2'], 'models 数组应该正确');
  
  console.log('✓ 注释解析测试通过');
});

// 测试解析后重新序列化
test('TOML Parser - 注释移除后重新序列化', () => {
  const tomlWithComments = `config_version = 5   # schema marker
default_model = "deepseek-v4-pro"   # default

[ui]
theme = "auto"   # theme setting
show_reasoning = true   # show thinking

[[providers]]
name = "loadout"
api_key_env = "LOADOUT_API_KEY"   # api key env var
models = [ "model1", "model2" ]
`;

  // 解析
  const json = tomlToJson(tomlWithComments);
  
  // 重新序列化
  const tomlGenerated = jsonToToml(json);
  
  // 验证生成的 TOML 不包含转义引号和注释
  assert.ok(!tomlGenerated.includes('\\"'), '生成的 TOML 不应包含转义引号');
  assert.ok(!tomlGenerated.includes('schema marker'), '生成的 TOML 不应包含注释');
  assert.ok(!tomlGenerated.includes('# '), '生成的 TOML 不应包含注释标记');
  
  // 验证关键字段正确序列化
  assert.ok(tomlGenerated.includes('config_version = 5'), 'config_version 应该是整数');
  assert.ok(tomlGenerated.includes('default_model = "deepseek-v4-pro"'), 'default_model 应该正确');
  assert.ok(tomlGenerated.includes('theme = "auto"'), 'theme 应该是字符串');
  assert.ok(tomlGenerated.includes('show_reasoning = true'), 'show_reasoning 应该是布尔值');
  assert.ok(tomlGenerated.includes('api_key_env = "LOADOUT_API_KEY"'), 'api_key_env 应该正确');
  
  console.log('✓ 重新序列化测试通过');
  console.log('生成的 TOML:');
  console.log(tomlGenerated);
});

// 测试往返转换（parse -> stringify -> parse）
test('TOML Parser - 往返转换测试', () => {
  const originalToml = `config_version = 5
default_model = "deepseek-v4-pro"
credentials_store = "auto"

[ui]
theme = "auto"
show_reasoning = true

[[providers]]
name = "loadout"
kind = "openai"
api_key_env = "LOADOUT_API_KEY"
models = [ "model1", "model2" ]
vision_models = [ "model1" ]

[[plugins]]
name = "mcp-smart"
type = "http"
url = "http://localhost:5173/mcp/$smart"
`;

  // 第一次解析
  const json1 = tomlToJson(originalToml);
  
  // 第一次序列化
  const toml1 = jsonToToml(json1);
  
  // 第二次解析
  const json2 = tomlToJson(toml1);
  
  // 第二次序列化
  const toml2 = jsonToToml(json2);
  
  // 验证 JSON 相同
  assert.deepStrictEqual(json1, json2, '两次解析结果应该相同');
  
  // 验证两次序列化结果相同
  assert.strictEqual(toml1, toml2, '两次序列化结果应该相同（幂等）');
  
  console.log('✓ 往返转换测试通过');
});

// 测试实际 Reasonix 配置格式
test('TOML Parser - 实际 Reasonix 配置文件', () => {
  setupTest();
  
  // 这是 Reasonix 的标准配置格式（带注释）
  const reasonixConfig = `# Reasonix configuration.
# Resolution order: flag > ./reasonix.toml > ~/AppData/Roaming/reasonix/config.toml > built-in defaults.
config_version = 5   # schema marker for diagnostics; old versions may ignore it
default_model = "deepseek-v4-pro"
credentials_store = "auto"   # legacy compatibility; provider keys are saved in Reasonix's global .env

[ui]
theme = "auto"   # auto|dark|light; CLI colors only; REASONIX_THEME can override per run
show_reasoning = true   # CLI: show thinking text by default; false = collapsed (toggle with Ctrl+O)

[desktop]
layout_style = "workbench"   # desktop layout: classic|workbench|creation
theme = "auto"   # desktop only: auto|dark|light

[[providers]]
name = "loadout"
kind = "openai"
base_url = "http://localhost:3000/v1"
api_key_env = "LOADOUT_API_KEY"
models = [ "claude-haiku-4-5-20251001", "deepseek-v4-pro" ]
default = "deepseek-v4-pro"
vision_models = [ "claude-haiku-4-5-20251001" ]

[[plugins]]
name = "mcp-smart"
type = "http"
url = "http://localhost:5173/mcp/$smart"
`;

  fs.writeFileSync(testConfigPath, reasonixConfig, 'utf-8');
  
  // 解析配置
  const json = tomlToJson(reasonixConfig);
  
  // 验证顶层配置
  assert.strictEqual(json.config_version, 5);
  assert.strictEqual(json.default_model, 'deepseek-v4-pro');
  assert.strictEqual(json.credentials_store, 'auto');
  
  // 验证 ui section
  assert.strictEqual(json.ui.theme, 'auto');
  assert.strictEqual(json.ui.show_reasoning, true);
  
  // 验证 desktop section
  assert.strictEqual(json.desktop.layout_style, 'workbench');
  
  // 验证 provider
  assert.strictEqual(json.providers[0].name, 'loadout');
  assert.strictEqual(json.providers[0].api_key_env, 'LOADOUT_API_KEY');
  assert.deepStrictEqual(json.providers[0].models, ['claude-haiku-4-5-20251001', 'deepseek-v4-pro']);
  
  // 验证 plugin
  assert.strictEqual(json.plugins[0].name, 'mcp-smart');
  assert.strictEqual(json.plugins[0].type, 'http');
  assert.strictEqual(json.plugins[0].url, 'http://localhost:5173/mcp/$smart');
  
  // 重新序列化
  const regenerated = jsonToToml(json);
  
  // 验证不包含转义引号
  assert.ok(!regenerated.includes('\\"'), '不应包含转义引号');
  assert.ok(!regenerated.includes('schema marker'), '不应包含原始注释');
  
  // 验证关键值正确
  assert.ok(regenerated.includes('config_version = 5'));
  assert.ok(regenerated.includes('api_key_env = "LOADOUT_API_KEY"'));
  assert.ok(regenerated.includes('show_reasoning = true'));
  
  cleanupTest();
  console.log('✓ Reasonix 配置文件测试通过');
});
