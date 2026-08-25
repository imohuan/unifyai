import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ReasonixAdapter } from '../src/adapters/reasonix-adapter.mjs';

// 创建临时测试目录
const testDir = path.join(os.tmpdir(), 'reasonix-model-sync-test');
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

// 测试模型同步时保留 api_key_env
test('Reasonix Adapter - syncModels 应正确序列化 api_key_env', async () => {
  setupTest();
  
  const initialConfig = `config_version = 5
default_model = "claude-haiku-4-5-20251001"

[[providers]]
name = "loadout"
kind = "openai"
base_url = "http://localhost:3000/v1"
api_key_env = "LOADOUT_API_KEY"
models = [ "claude-haiku-4-5-20251001" ]
default = "claude-haiku-4-5-20251001"
`;
  
  fs.writeFileSync(testConfigPath, initialConfig, 'utf-8');
  
  const adapter = new ReasonixAdapter();
  adapter.getConfigPath = () => testConfigPath;
  
  // 准备要同步的模型
  const models = [
    {
      provider: 'loadout',
      providerConfig: {
        baseUrl: 'http://localhost:3000/v1',
        apiKey: 'sk-test-key-12345',
        defaultModel: 'deepseek-v4-pro'
      },
      modelId: 'deepseek-v4-pro',
      supportsVision: true
    },
    {
      provider: 'loadout',
      providerConfig: {
        baseUrl: 'http://localhost:3000/v1',
        apiKey: 'sk-test-key-12345',
        defaultModel: 'deepseek-v4-pro'
      },
      modelId: 'deepseek-v4-flash',
      supportsVision: false
    }
  ];
  
  // 执行同步
  await adapter.syncModels(models);
  
  // 读取结果文件
  const result = fs.readFileSync(testConfigPath, 'utf-8');
  
  // 验证 api_key_env 正确序列化
  assert.ok(result.includes('api_key_env = "LOADOUT_API_KEY"'), 
    '应该正确序列化 api_key_env');
  
  // 验证 models 数组正确序列化
  assert.ok(result.includes('models = [ "deepseek-v4-pro", "deepseek-v4-flash" ]'),
    '应该正确序列化 models 数组');
  
  // 验证 default 模型正确序列化
  assert.ok(result.includes('default = "deepseek-v4-pro"'),
    '应该正确序列化 default 模型');
  
  // 验证 vision_models 正确序列化
  assert.ok(result.includes('vision_models = [ "deepseek-v4-pro" ]'),
    '应该正确序列化 vision_models 数组');
  
  console.log('✓ 模型同步测试结果:');
  console.log(result);
  
  cleanupTest();
});

// 测试保留顶层的 default_model 和 config_version
test('Reasonix Adapter - syncModels 应保留顶层配置字段', async () => {
  setupTest();
  
  const initialConfig = `config_version = 5
default_model = "deepseek-v4-pro"
credentials_store = "auto"

[[providers]]
name = "loadout"
kind = "openai"
base_url = "http://localhost:3000/v1"
api_key_env = "LOADOUT_API_KEY"
models = [ "old-model" ]
default = "old-model"
`;
  
  fs.writeFileSync(testConfigPath, initialConfig, 'utf-8');
  
  const adapter = new ReasonixAdapter();
  adapter.getConfigPath = () => testConfigPath;
  
  const models = [
    {
      provider: 'loadout',
      providerConfig: {
        baseUrl: 'http://localhost:3000/v1',
        apiKey: 'sk-test',
        defaultModel: 'new-model'
      },
      modelId: 'new-model',
      supportsVision: true
    }
  ];
  
  await adapter.syncModels(models);
  
  const result = fs.readFileSync(testConfigPath, 'utf-8');
  
  // 验证顶层字段被保留
  assert.ok(result.includes('config_version = 5'),
    '应该保留 config_version');
  assert.ok(result.includes('default_model = "deepseek-v4-pro"'),
    '应该保留 default_model');
  assert.ok(result.includes('credentials_store = "auto"'),
    '应该保留 credentials_store');
  
  // 验证 provider 被更新
  assert.ok(result.includes('api_key_env = "LOADOUT_API_KEY"'),
    '应该保留 api_key_env');
  assert.ok(result.includes('models = [ "new-model" ]'),
    '应该更新 models 列表');
  
  cleanupTest();
});

// 测试多个 provider 的同步
test('Reasonix Adapter - syncModels 应处理多个 provider', async () => {
  setupTest();
  
  const initialConfig = `config_version = 5
default_model = "loadout-default"

[[providers]]
name = "loadout"
kind = "openai"
base_url = "http://localhost:3000/v1"
api_key_env = "LOADOUT_API_KEY"
models = []

[[providers]]
name = "deepseek"
kind = "openai"
base_url = "https://api.deepseek.com/v1"
api_key_env = "DEEPSEEK_API_KEY"
models = []
`;
  
  fs.writeFileSync(testConfigPath, initialConfig, 'utf-8');
  
  const adapter = new ReasonixAdapter();
  adapter.getConfigPath = () => testConfigPath;
  
  const models = [
    {
      provider: 'loadout',
      providerConfig: {
        baseUrl: 'http://localhost:3000/v1',
        apiKey: 'loadout-key',
        defaultModel: 'loadout-model'
      },
      modelId: 'loadout-model',
      supportsVision: true
    },
    {
      provider: 'deepseek',
      providerConfig: {
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'deepseek-key',
        defaultModel: 'deepseek-v4-pro'
      },
      modelId: 'deepseek-v4-pro',
      supportsVision: true
    }
  ];
  
  await adapter.syncModels(models);
  
  const result = fs.readFileSync(testConfigPath, 'utf-8');
  
  // 验证两个 provider 都有正确的 api_key_env
  assert.ok(result.includes('name = "loadout"'), '应该包含 loadout provider');
  assert.ok(result.includes('api_key_env = "LOADOUT_API_KEY"'), 
    '应该保留 loadout 的 api_key_env');
  
  assert.ok(result.includes('name = "deepseek"'), '应该包含 deepseek provider');
  assert.ok(result.includes('api_key_env = "DEEPSEEK_API_KEY"'),
    '应该保留 deepseek 的 api_key_env');
  
  // 验证模型都正确序列化
  assert.ok(result.includes('models = [ "loadout-model" ]'),
    '应该正确序列化 loadout 的模型');
  assert.ok(result.includes('models = [ "deepseek-v4-pro" ]'),
    '应该正确序列化 deepseek 的模型');
  
  cleanupTest();
});
