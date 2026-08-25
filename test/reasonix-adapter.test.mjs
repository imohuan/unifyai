import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ReasonixAdapter } from '../src/adapters/reasonix-adapter.mjs';

// 创建临时测试目录
const testDir = path.join(os.tmpdir(), 'reasonix-adapter-test');
const testConfigPath = path.join(testDir, 'config.toml');

// 准备测试环境
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

// 测试基础配置
test('Reasonix Adapter - 初始化状态', () => {
  const adapter = new ReasonixAdapter();
  assert.equal(adapter.platformName, 'Reasonix');
  assert.equal(adapter.supportsModels, true);
  assert.equal(adapter.supportsMcp, true);
  assert.equal(adapter.mcpStatus, 'supported');
  assert.equal(adapter.configFormat, 'toml');
});

test('Reasonix Adapter - 配置路径', () => {
  const adapter = new ReasonixAdapter();
  const configPath = adapter.getConfigPath();
  // Windows APPDATA 路径
  assert.ok(configPath.includes('reasonix'));
  assert.ok(configPath.includes('config.toml'));
});

// 测试 MCP 同步 - 标准 [[plugins]] 格式
test('Reasonix Adapter - syncMcp 创建新的 stdio 类型 plugin', async () => {
  setupTest();
  
  // 创建初始配置（标准格式）
  const initialConfig = `config_version = "5"
default_model = "deepseek-pro"
[[providers]]
name = "deepseek"
kind = "openai"

[[plugins]]
name = "example"
command = "test-cmd"
`;
  
  fs.writeFileSync(testConfigPath, initialConfig, 'utf-8');
  
  // 创建临时 adapter（指向测试配置）
  const adapter = new ReasonixAdapter();
  adapter.getConfigPath = () => testConfigPath;
  
  // 准备 MCP 服务器配置
  const mcpServers = {
    'stdio-server': {
      enabled: true,
      transport: 'stdio',
      command: 'my-mcp-server',
      args: ['--debug'],
      env: { DEBUG: 'true' }
    }
  };
  
  // 执行同步
  await adapter.syncMcp(mcpServers);
  
  // 验证结果
  const result = fs.readFileSync(testConfigPath, 'utf-8');
  assert.ok(result.includes('name = "stdio-server"'));
  assert.ok(result.includes('type = "stdio"'));
  assert.ok(result.includes('command = "my-mcp-server"'));
  assert.ok(result.includes('args = [ "--debug" ]'));
  
  cleanupTest();
});

// 测试 MCP 同步 - HTTP 远程服务器
test('Reasonix Adapter - syncMcp 创建 HTTP 类型的远程 plugin', async () => {
  setupTest();
  
  const initialConfig = `config_version = "5"
default_model = "deepseek-pro"

[[plugins]]
`;
  
  fs.writeFileSync(testConfigPath, initialConfig, 'utf-8');
  
  const adapter = new ReasonixAdapter();
  adapter.getConfigPath = () => testConfigPath;
  
  const mcpServers = {
    'http-server': {
      enabled: true,
      transport: 'streamable-http',
      url: 'https://api.example.com/mcp',
      headers: { Authorization: 'Bearer token123' }
    }
  };
  
  await adapter.syncMcp(mcpServers);
  
  const result = fs.readFileSync(testConfigPath, 'utf-8');
  assert.ok(result.includes('name = "http-server"'));
  assert.ok(result.includes('type = "http"'));
  assert.ok(result.includes('url = "https://api.example.com/mcp"'));
  assert.ok(result.includes('Authorization'));
  
  cleanupTest();
});

// 测试禁用服务器的处理
test('Reasonix Adapter - syncMcp 应移除被禁用的服务器', async () => {
  setupTest();
  
  const initialConfig = `config_version = "5"

[[plugins]]
name = "old-server"
command = "old-cmd"

[[plugins]]
name = "keep-server"
command = "keep-cmd"
`;
  
  fs.writeFileSync(testConfigPath, initialConfig, 'utf-8');
  
  const adapter = new ReasonixAdapter();
  adapter.getConfigPath = () => testConfigPath;
  
  const mcpServers = {
    'old-server': {
      enabled: false  // 禁用
    },
    'keep-server': {
      enabled: true,
      transport: 'stdio',
      command: 'keep-cmd'
    }
  };
  
  await adapter.syncMcp(mcpServers);
  
  const result = fs.readFileSync(testConfigPath, 'utf-8');
  assert.ok(!result.includes('old-server'), '被禁用的服务器应被移除');
  assert.ok(result.includes('keep-server'), '启用的服务器应保留');
  
  cleanupTest();
});

// 测试 clearMcpExcept
test('Reasonix Adapter - clearMcpExcept 应保留指定的服务器', async () => {
  setupTest();
  
  const initialConfig = `config_version = "5"

[[plugins]]
name = "server-a"
command = "cmd-a"

[[plugins]]
name = "server-b"
command = "cmd-b"

[[plugins]]
name = "server-c"
command = "cmd-c"
`;
  
  fs.writeFileSync(testConfigPath, initialConfig, 'utf-8');
  
  const adapter = new ReasonixAdapter();
  adapter.getConfigPath = () => testConfigPath;
  
  // 只保留 server-b
  const keepNames = new Set(['server-b']);
  const deleted = await adapter.clearMcpExcept(keepNames);
  
  // 验证删除的列表
  assert.ok(deleted.includes('server-a'));
  assert.ok(deleted.includes('server-c'));
  assert.equal(deleted.length, 2);
  
  // 验证文件内容
  const result = fs.readFileSync(testConfigPath, 'utf-8');
  assert.ok(!result.includes('server-a'));
  assert.ok(result.includes('server-b'));
  assert.ok(!result.includes('server-c'));
  
  cleanupTest();
});

// 测试 deleteMcp
test('Reasonix Adapter - deleteMcp 应删除指定的服务器', async () => {
  setupTest();
  
  const initialConfig = `config_version = "5"

[[plugins]]
name = "server-1"
command = "cmd-1"

[[plugins]]
name = "server-2"
command = "cmd-2"

[[plugins]]
name = "server-3"
command = "cmd-3"
`;
  
  fs.writeFileSync(testConfigPath, initialConfig, 'utf-8');
  
  const adapter = new ReasonixAdapter();
  adapter.getConfigPath = () => testConfigPath;
  
  // 删除 server-1 和 server-3
  const deleted = await adapter.deleteMcp(['server-1', 'server-3']);
  
  // 验证删除的列表
  assert.ok(deleted.includes('server-1'));
  assert.ok(deleted.includes('server-3'));
  assert.equal(deleted.length, 2);
  
  // 验证文件内容
  const result = fs.readFileSync(testConfigPath, 'utf-8');
  assert.ok(!result.includes('server-1'));
  assert.ok(result.includes('server-2'));
  assert.ok(!result.includes('server-3'));
  
  cleanupTest();
});

// 测试 dryRun 模式
test('Reasonix Adapter - deleteMcp dryRun 不应修改文件', async () => {
  setupTest();
  
  const initialConfig = `config_version = "5"

[[plugins]]
name = "server-1"
command = "cmd-1"
`;
  
  fs.writeFileSync(testConfigPath, initialConfig, 'utf-8');
  
  const adapter = new ReasonixAdapter();
  adapter.getConfigPath = () => testConfigPath;
  
  // dryRun 模式
  const deleted = await adapter.deleteMcp(['server-1'], { dryRun: true });
  
  // 验证返回列表（应该有 server-1）
  assert.ok(deleted.includes('server-1'));
  
  // 验证文件未被修改
  const result = fs.readFileSync(testConfigPath, 'utf-8');
  assert.ok(result.includes('server-1'), 'dryRun 模式不应修改文件');
  
  cleanupTest();
});

// 测试实际配置文件格式问题
test('Reasonix Adapter - 处理非标准的 plugins 数组格式', async () => {
  setupTest();
  
  // 这是用户实际文件中发现的格式
  const actualConfig = `config_version = "5"
default_model = "deepseek-pro/deepseek-v4-pro"
providers = [ ]
plugins = [ "", "", "" ]

[ui]
theme = "auto"
`;
  
  fs.writeFileSync(testConfigPath, actualConfig, 'utf-8');
  
  const adapter = new ReasonixAdapter();
  adapter.getConfigPath = () => testConfigPath;
  
  // 尝试同步 - 应该能正确处理这种格式
  const mcpServers = {
    'new-server': {
      enabled: true,
      transport: 'stdio',
      command: 'test-mcp'
    }
  };
  
  try {
    await adapter.syncMcp(mcpServers);
    const result = fs.readFileSync(testConfigPath, 'utf-8');
    // 验证新 plugin 被正确添加
    assert.ok(result.includes('name = "new-server"'), '应该成功添加新 plugin');
  } catch (error) {
    console.error('同步失败，这表明存在格式问题:', error.message);
    throw error;
  }
  
  cleanupTest();
});
