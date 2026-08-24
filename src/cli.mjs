#!/usr/bin/env node

/**
 * cli.mjs
 * AI Config Sync - CLI 主入口
 */

import { Command } from 'commander';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { ConfigLoader } from './core/config-loader.mjs';
import { MetadataFetcher } from './core/metadata-fetcher.mjs';
import { OpenCodeAdapter } from './adapters/opencode-adapter.mjs';
import { CodexAdapter } from './adapters/codex-adapter.mjs';
import { ClaudeCodeAdapter } from './adapters/claude-code-adapter.mjs';

// 从 package.json 读取版本号（单一来源，避免与 package.json 手动同步）
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
import { ReasonixAdapter } from './adapters/reasonix-adapter.mjs';
import { PenguinAdapter } from './adapters/penguin-adapter.mjs';

// 可用的适配器
const ADAPTERS = {
  opencode: OpenCodeAdapter,
  codex: CodexAdapter,
  claudecode: ClaudeCodeAdapter,
  reasonix: ReasonixAdapter,
  penguin: PenguinAdapter
};

const program = new Command();

// 收集多次指定的 option（如 --mcp-exclude-for codex=node_env --mcp-exclude-for opencode=foo）
function collect(value, previous) {
  return previous.concat([value]);
}

// 解析源 mcp.json（cwd 优先，回退 ~/.unifyai/mcp.json）
// @returns {{path: string, servers: Array<{name: string, enabled: boolean}>}|null}
function resolveSourceMcp() {
  const cwdPath = path.join(process.cwd(), 'mcp.json');
  const userPath = path.join(os.homedir(), '.unifyai', 'mcp.json');
  let mcpPath = null;
  if (fs.existsSync(cwdPath)) mcpPath = cwdPath;
  else if (fs.existsSync(userPath)) mcpPath = userPath;
  if (!mcpPath) return null;
  const cfg = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
  const servers = Object.entries(cfg.mcpServers || {}).map(([name, s]) => ({
    name,
    enabled: s.enabled !== false && s.disabled !== true,
    config: s
  }));
  return { path: mcpPath, servers };
}

// 从 headers 提取 Bearer token（兼容 Authorization 大小写）
function extractBearer(headers) {
  if (!headers || typeof headers !== 'object') return null;
  const auth = headers.Authorization || headers.authorization || '';
  const m = String(auth).match(/Bearer\s+(.+)/);
  return m ? m[1] : null;
}

/**
 * 平台配置条目 → 统一格式（syncMcp 消费：enabled/transport/command/args/url/bearerToken/env）
 * 支持 opencode / codex / claudecode / penguin 四种可读平台的 config 结构
 * @returns {Object|null}
 */
function platformConfigToUnified(platformId, cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const enabled = cfg.enabled !== false;

  if (platformId === 'opencode') {
    const isRemote = cfg.type === 'remote' || !!cfg.url;
    return {
      enabled,
      transport: isRemote ? 'streamable-http' : 'stdio',
      command: isRemote ? null : (Array.isArray(cfg.command) ? cfg.command[0] : cfg.command),
      args: isRemote ? null : (Array.isArray(cfg.command) ? cfg.command.slice(1) : []),
      url: cfg.url || null,
      bearerToken: extractBearer(cfg.headers),
      env: cfg.environment || cfg.env || {}
    };
  }
  if (platformId === 'codex') {
    const isRemote = !!cfg.url;
    return {
      enabled,
      transport: isRemote ? 'streamable-http' : 'stdio',
      command: isRemote ? null : cfg.command,
      args: isRemote ? null : (cfg.args || []),
      url: cfg.url || null,
      bearerToken: extractBearer(cfg.http_headers),
      env: cfg.env || {}
    };
  }
  if (platformId === 'claudecode') {
    const isRemote = !!cfg.url || cfg.type === 'streamable-http' || cfg.type === 'sse';
    return {
      enabled,
      transport: cfg.type === 'sse' ? 'sse' : (isRemote ? 'streamable-http' : 'stdio'),
      command: isRemote ? null : cfg.command,
      args: isRemote ? null : (cfg.args || []),
      url: cfg.url || null,
      bearerToken: extractBearer(cfg.headers),
      env: cfg.env || {}
    };
  }
  if (platformId === 'penguin') {
    const c = cfg.config || cfg;
    const isRemote = c.transport === 'http' || c.transport === 'sse' || !!c.url;
    return {
      enabled,
      transport: c.transport === 'sse' ? 'sse' : (isRemote ? 'streamable-http' : 'stdio'),
      command: isRemote ? null : c.command,
      args: isRemote ? null : (c.args || []),
      url: c.url || null,
      bearerToken: extractBearer(c.headers),
      env: c.env || {}
    };
  }
  return null;
}

/** 平台配置 → mcp.json 条目格式（--import-mcp 用） */
function platformConfigToMcpJson(platformId, cfg) {
  const u = platformConfigToUnified(platformId, cfg);
  if (!u) return null;
  if (u.transport === 'stdio') {
    const entry = { type: 'local', enabled: u.enabled, command: [u.command, ...(u.args || [])].filter(Boolean) };
    if (u.env && Object.keys(u.env).length > 0) entry.env = u.env;
    return entry;
  }
  const entry = { type: 'remote', enabled: u.enabled, url: u.url };
  if (u.bearerToken) entry.headers = { Authorization: `Bearer ${u.bearerToken}` };
  return entry;
}

// ============ 数据获取（--list / 各 --list-* 共用） ============

/** 平台能力列表（--list-platforms 数据） */
function fetchPlatforms() {
  return Object.entries(ADAPTERS).map(([id, AdapterClass]) => new AdapterClass().getInfo());
}

function printPlatforms(platforms) {
  const STATUS_ICON = {
    supported:        '✓ ',
    not_supported:    '✗ ',
    not_implemented:  '⚠ '
  };
  console.log('\n📋 支持的平台:\n');
  for (const p of platforms) {
    console.log(`  ${p.id.padEnd(12)} 模型: ${STATUS_ICON[p.modelStatus]} MCP: ${STATUS_ICON[p.mcpStatus]}`);
    if (p.mcpStatus === 'not_implemented') {
      console.log(`             ⚠ MCP 同步未实现（已跳过）`);
    }
  }
  console.log();
}

/** 模型列表（--list-models 数据）：拉取 + 增强元数据，返回 slim 结构 */
async function fetchModels(options) {
  const result = await ConfigLoader.fetchOpenCodexModels(options.source, { quiet: true });
  const orModels = await MetadataFetcher.getOpenRouterModels();
  await MetadataFetcher.enrich(result.models, orModels, {
    visionOverride: options.enableVision === true
  });
  const matchedCount = result.models.filter(m =>
    MetadataFetcher.findInOpenRouter(m.modelId, orModels)
  ).length;
  return {
    ...result,
    orMatchedCount: matchedCount,
    orTotal: orModels.length,
    models: result.models.map(m => ({
      provider: m.provider,
      modelId: m.modelId,
      displayName: m.displayName,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      supportsVision: m.supportsVision,
      supportsThinking: m.supportsThinking
    }))
  };
}

function printModels(result) {
  console.log('\n🚀 AI Config Sync - 模型列表');
  console.log(`📂 加载配置: ${result.source}`);
  console.log(`✓ 加载配置: ${result.providerCount} 个 provider`);
  if (result.hasApiKey) {
    console.log(`✓ 已携带 OpenCodex 代理 API key (${result.apiKeyPreview})`);
  }
  if (result.degraded) {
    console.log(`\n⚠ ${result.degradedReason}`);
    return;
  }
  console.log(`\n✓ 从 OpenCodex 代理服务获取模型列表 (${result.proxyUrl})`);
  console.log(`  ✓ 获取到 ${result.rawCount} 个模型，过滤后 ${result.count} 个（来自 ${result.enabledProviderCount} 个启用 provider）`);
  console.log(`🔍 匹配 OpenRouter 元数据: ${result.orMatchedCount}/${result.count} 个模型命中\n`);
  const grouped = {};
  for (const model of result.models) {
    if (!grouped[model.provider]) grouped[model.provider] = [];
    grouped[model.provider].push(model);
  }
  for (const [provider, models] of Object.entries(grouped)) {
    console.log(`  ${provider} (${models.length} 个模型):`);
    for (const model of models) {
      const reasoning = model.supportsThinking ? '🧠' : '  ';
      const vision = model.supportsVision ? '👁️' : '  ';
      const ctx = model.contextWindow ? `${(model.contextWindow / 1000).toFixed(0)}K` : '???';
      console.log(`    ${reasoning}${vision} ${model.modelId.padEnd(40)} [${ctx.padStart(6)}]`);
    }
  }
  console.log(`\n✓ 总计: ${result.count} 个模型`);
}

/** MCP 清单（--list-mcp 数据）：源 mcp.json + 各平台开关状态 */
function fetchMcpList(options) {
  const src = resolveSourceMcp();
  const platformFilter = options.platforms
    ? options.platforms.split(',').map(p => p.trim())
    : null;
  const platforms = Object.entries(ADAPTERS)
    .filter(([id]) => !platformFilter || platformFilter.includes(id))
    .map(([id, AdapterClass]) => {
      const adapter = new AdapterClass();
      const servers = adapter.getMcpServers();
      return {
        platform: id,
        name: adapter.platformName,
        configPath: adapter.getInfo().configPath,
        readable: servers !== null,
        servers: servers || []
      };
    });
  return { source: src, platforms };
}

function printMcpList({ source: src, platforms }) {
  console.log('\n📋 MCP 配置总览\n');
  if (src) {
    console.log(`源配置 (${src.path}):`);
    for (const s of src.servers) {
      console.log(`  ${s.enabled ? '🟢' : '⚪'} ${s.name}`);
    }
  } else {
    console.log('源配置: 未找到（cwd/mcp.json 或 ~/.unifyai/mcp.json）');
  }
  console.log();
  for (const p of platforms) {
    console.log(`${p.name} (${p.configPath}):`);
    if (!p.readable) {
      console.log('  ⚠ 暂不支持读取');
    } else if (p.servers.length === 0) {
      console.log('  (无 MCP 配置)');
    } else {
      for (const s of p.servers) {
        console.log(`  ${s.enabled ? '🟢' : '⚪'} ${s.name}`);
      }
    }
    console.log();
  }
}

/** 更新元数据缓存并返回缓存状态（--update-metadata / --list metadata） */
async function refreshMetadata() {
  await MetadataFetcher.updateCache();
  return metadataStatus();
}

/** 读取 OpenRouter 元数据缓存状态（不触发网络请求） */
function metadataStatus() {
  const cachePath = path.join(os.homedir(), '.unifyai', 'cache', 'openrouter-models.json');
  try {
    if (!fs.existsSync(cachePath)) {
      return { path: cachePath, modelCount: 0, cachedAt: null, degraded: '缓存不存在，先运行 --list metadata 或 --update-metadata' };
    }
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    const models = Array.isArray(data.models) ? data.models : Array.isArray(data) ? data : [];
    const stat = fs.statSync(cachePath);
    return { path: cachePath, modelCount: models.length, cachedAt: new Date(stat.mtime).toISOString() };
  } catch (e) {
    return { path: cachePath, modelCount: 0, cachedAt: null, degraded: `读取缓存失败: ${e.message}` };
  }
}

// ============ 同步执行（--config / --mcp-matrix / 默认全量共用） ============

/**
 * 构造每个平台要同步的 mcpServers 集合（矩阵模式）
 * @param {Object} matrix { platform: { server: true/false/'remove' } }
 *   true=开启 / false=关闭 / 'remove'=删除条目
 * @param {Object} ctx { sourceServers, otherPlatformServers }
 */
function buildMatrixToSync(matrix, ctx) {
  const { sourceServers, otherPlatformServers } = ctx;
  const perPlatform = {};
  for (const [platformId, entries] of Object.entries(matrix)) {
    const toSync = {};
    const missing = [];
    const remove = [];
    for (const [name, action] of Object.entries(entries || {})) {
      if (action === 'remove') {
        // 删除：不写入同步集，交给 deleteMcp 处理
        remove.push(name);
        continue;
      }
      if (action === false) {
        // 关闭：优先带完整配置（保留 command/url 只改 enabled），避免把 null 字段写进目标平台；
        // 无配置来源时跳过（避免写 command:null 残缺条目）
        const base = sourceServers[name] || otherPlatformServers[name]?.unified;
        if (!base) {
          missing.push(name);
          continue;
        }
        toSync[name] = { ...base, name, enabled: false };
        continue;
      }
      const fromSource = sourceServers[name];
      const fromOther = otherPlatformServers[name]?.unified;
      if (!fromSource && !fromOther) {
        missing.push(name);
        continue;
      }
      toSync[name] = { ...(fromSource || fromOther), name, enabled: true };
    }
    perPlatform[platformId] = { toSync, missing, remove };
  }
  return perPlatform;
}

/** 收集配置来源：源 mcp.json（统一格式）+ 其他平台已配置的同名 server */
function collectConfigSources() {
  const src = resolveSourceMcp();
  let sourceServers = {};
  if (src) {
    const cfg = JSON.parse(fs.readFileSync(src.path, 'utf-8'));
    sourceServers = cfg.mcpServers ? ConfigLoader.normalizeMcp(cfg.mcpServers) : {};
  }
  const otherPlatformServers = {};
  for (const [id, AdapterClass] of Object.entries(ADAPTERS)) {
    const adapter = new AdapterClass();
    const servers = adapter.getMcpServers();
    if (servers === null) continue;
    for (const s of servers) {
      if (!otherPlatformServers[s.name]) {
        otherPlatformServers[s.name] = {
          platform: id,
          unified: platformConfigToUnified(id, s.config)
        };
      }
    }
  }
  return { sourceServers, otherPlatformServers, sourcePath: src ? src.path : null };
}


/**
 * 全量同步（--config 无矩阵 / 默认执行共用）
 * @param {Object} opts { mode, all, platforms, mcpPlatforms, mcpExclude, perPlatformMcpExclude, mcpMatrix, dryRun, source, enableVision, force }
 */
async function runFullSync(opts) {
  const {
    mode = 'all',
    all = false,
    platforms: platformList = null,
    mcpPlatforms = null,
    mcpExclude = [],
    perPlatformMcpExclude = {},
    mcpMatrix = null,
    dryRun = false,
    enableVision = false,
    forceMcp = false
  } = opts;
  let source = opts.source;
  const modelsOnly = mode === 'models';
  const mcpOnly = mode === 'mcp';

  // 展开 ~ 为用户主目录（sync.json / --source 可能带字面 ~，Node fs 不识别）
  if (source && source.startsWith('~')) {
    source = source === '~' ? os.homedir() : path.join(os.homedir(), source.slice(1));
  }

  // 矩阵模式：构造每平台要同步的 MCP 集合（模型同步不受影响，仍走下方流程）
  let matrixPerPlatform = null;
  let matrixCtx = null;
  if (mcpMatrix && !modelsOnly) {
    matrixCtx = collectConfigSources();
    matrixPerPlatform = buildMatrixToSync(mcpMatrix, matrixCtx);
    console.log(`📂 源配置: ${matrixCtx.sourcePath} (${Object.keys(matrixCtx.sourceServers).length} 个服务器)`);
    const otherCount = Object.keys(matrixCtx.otherPlatformServers).length;
    if (otherCount > 0) {
      console.log(`🔍 跨平台配置来源: ${otherCount} 个服务器（矩阵未配置项的复制来源）`);
    }
  }

  console.log(`📂 加载配置: ${source}`);
  const config = await ConfigLoader.load(source);
  const mcpServers = config.mcp?.mcpServers
    ? ConfigLoader.normalizeMcp(config.mcp.mcpServers)
    : {};

  if (!mcpOnly && config.models.length > 0) {
    console.log('\n🔍 增强模型元数据...');
    config.models = await MetadataFetcher.enrich(config.models, null, {
      visionOverride: enableVision === true
    });
    console.log(`✓ ${config.models.length} 个模型元数据已增强`);
  }

  if (config.models.length > 0 && !mcpOnly) {
    console.log('\n📋 模型列表:');
    const grouped = {};
    for (const model of config.models) {
      if (!grouped[model.provider]) grouped[model.provider] = [];
      grouped[model.provider].push(model);
    }
    for (const [provider, models] of Object.entries(grouped)) {
      console.log(`\n  ${provider} (${models.length} 个模型):`);
      for (const model of models.slice(0, 10)) {
        const reasoning = model.supportsThinking ? '🧠' : '  ';
        const vision = model.supportsVision ? '👁️' : '  ';
        const ctx = model.contextWindow ? `${(model.contextWindow / 1000).toFixed(0)}K` : '???';
        console.log(`    ${reasoning}${vision} ${model.modelId.padEnd(35)} [${ctx.padStart(6)}]`);
      }
      if (models.length > 10) {
        console.log(`    ... 还有 ${models.length - 10} 个模型`);
      }
    }
  }

  const platforms = all
    ? Object.keys(ADAPTERS)
    : (platformList && platformList.length ? platformList : Object.keys(ADAPTERS));

  console.log(`\n🎯 目标平台: ${platforms.join(', ')}`);
  if (dryRun) console.log('⚠️  预览模式：不会实际写入文件\n');

  const globalMcpExclude = new Set(mcpExclude);
  const mcpWhitelist = mcpPlatforms && mcpPlatforms.length ? mcpPlatforms : null;

  let successCount = 0;
  let failCount = 0;
  const errors = [];

  for (const platformName of platforms) {
    const AdapterClass = ADAPTERS[platformName];
    if (!AdapterClass) {
      console.warn(`\n⚠️  未知平台: ${platformName}`);
      failCount++;
      continue;
    }
    const adapter = new AdapterClass();

    let platformMcp = mcpServers;
    const excludedNames = [];
    const matrixDetails = [];
    if (matrixPerPlatform) {
      // 矩阵模式：MCP 集合由矩阵决定（true=开启/添加，false=关闭，'remove'=删除）
      const entry = matrixPerPlatform[platformName] || { toSync: {}, missing: [], remove: [] };
      platformMcp = entry.toSync;
      for (const [name, server] of Object.entries(entry.toSync)) {
        const on = server.enabled !== false;
        const fromSource = !!matrixCtx.sourceServers[name];
        const fromOther = matrixCtx.otherPlatformServers[name]
          ? `复制自 ${matrixCtx.otherPlatformServers[name].platform}`
          : null;
        const origin = fromSource ? '源配置' : fromOther || '无配置来源';
        matrixDetails.push(`${on ? '✓' : '✗'} ${name.padEnd(28)} ${on ? '开启' : '关闭'}  (${origin})`);
      }
      for (const name of entry.missing) {
        matrixDetails.push(`⚠ ${name.padEnd(28)} 跳过  (无配置来源)`);
      }
      // 'remove' 值：真删目标平台该条目（失败计入该平台 fail，不中断整个同步）
      if (entry.remove.length > 0 && adapter.supportsMcp) {
        try {
          const removed = await adapter.deleteMcp(entry.remove, { dryRun });
          for (const name of removed) {
            matrixDetails.push(`✗ ${name.padEnd(28)} 删除  (矩阵标记)`);
          }
        } catch (e) {
          matrixDetails.push(`⚠ ${entry.remove.join(', ').padEnd(28)} 删除失败 (${e.message})`);
          console.error(`  ✗ ${platformName} 矩阵删除失败: ${e.message}`);
        }
      }
    } else if (mcpWhitelist && !mcpWhitelist.includes(platformName)) {
      platformMcp = {};
      console.log(`\n  ⊘ ${platformName}: MCP 同步已跳过（不在 mcp 白名单）`);
    } else {
      const excludeSet = perPlatformMcpExclude[platformName] || new Set();
      const filtered = {};
      for (const [name, server] of Object.entries(mcpServers)) {
        if (globalMcpExclude.has(name) || excludeSet.has(name)) {
          excludedNames.push(name);
          continue;
        }
        filtered[name] = server;
      }
      platformMcp = filtered;
    }

    // force-mcp：目标平台有但未在本次同步列表的 MCP 服务器 → 真正删除（重置）
    // 仅模型模式（modelsOnly）不动 MCP，避免"只同步模型"时误删目标平台 MCP
    if (forceMcp && !modelsOnly && adapter.supportsMcp) {
      try {
        const alreadyRemoved = new Set(matrixPerPlatform?.[platformName]?.remove || []);
        const removed = await adapter.clearMcpExcept(new Set(Object.keys(platformMcp)), { dryRun });
        for (const name of removed) {
          if (alreadyRemoved.has(name)) continue; // 矩阵已标记删除，不重复显示
          matrixDetails.push(`✗ ${name.padEnd(28)} 删除  (--force-mcp 强制重置)`);
        }
      } catch (e) {
        matrixDetails.push(`⚠ forceMcp 重置失败 (${e.message})`);
        console.error(`  ✗ ${platformName} forceMcp 重置失败: ${e.message}`);
      }
    }

    try {
      if (dryRun) {
        console.log(`\n📦 [预览] ${platformName}...`);
        console.log(`  配置文件: ${adapter.getConfigPath()}`);
        if (!mcpOnly && adapter.supportsModels) {
          console.log(`  → 将同步 ${config.models.length} 个模型`);
        }
        if (!modelsOnly && adapter.supportsMcp) {
          if (matrixDetails.length > 0) {
            const keepCount = Object.keys(platformMcp).length;
            const delCount = matrixDetails.filter(l => l.includes('--force-mcp 强制重置')).length;
            const summary = forceMcp && delCount > 0
              ? `将同步 ${keepCount} 个（--force-mcp 另删 ${delCount} 个）:`
              : `将同步 ${keepCount} 个 MCP 服务器（矩阵驱动）:`;
            console.log(`  → ${summary}`);
            for (const line of matrixDetails) {
              console.log(`    ${line}`);
            }
          } else {
            const mcpCount = Object.keys(platformMcp).length;
            console.log(`  → 将同步 ${mcpCount} 个 MCP 服务器${excludedNames.length ? ` (排除 ${excludedNames.join(', ')})` : ''}`);
          }
        }
        successCount++;
      } else {
        await adapter.sync(
          { models: config.models, mcp: platformMcp },
          { modelsOnly, mcpOnly }
        );
        if (matrixDetails.length > 0) {
          console.log(`\n  ✓ ${platformName} MCP（矩阵驱动）:`);
          for (const line of matrixDetails) {
            console.log(`    ${line}`);
          }
        } else if (excludedNames.length > 0) {
          console.log(`  ⊘ 已排除 MCP: ${excludedNames.join(', ')}`);
        }
        successCount++;
      }
    } catch (error) {
      failCount++;
      errors.push({ platform: platformName, error: error.message });
      console.error(`\n❌ ${platformName} 同步失败: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`✓ 成功: ${successCount} 个平台`);
  if (failCount > 0) {
    console.log(`✗ 失败: ${failCount} 个平台`);
    if (errors.length > 0) {
      console.log('\n失败详情:');
      for (const { platform, error } of errors) {
        console.log(`  • ${platform}: ${error}`);
      }
    }
  }
  console.log('='.repeat(50) + '\n');
  return { successCount, failCount, errors };
}

/** 解析 --config 参数：JSON 字符串或文件路径 */
function parseConfigOption(value) {
  let cfg = null;
  try {
    cfg = JSON.parse(value);
  } catch {
    // 不是 JSON → 按文件路径读
    const p = value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value;
    if (!fs.existsSync(p)) {
      throw new Error(`--config 不是合法 JSON 也不是存在的文件: ${value}`);
    }
    try {
      cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (e) {
      throw new Error(`--config 文件解析失败 (${p}): ${e.message}`);
    }
  }
  if (typeof cfg !== 'object' || Array.isArray(cfg) || !cfg) {
    throw new Error('--config 必须是 JSON 对象');
  }
  return cfg;
}

program
  .name('unifyai')
  .description('同步 AI 配置到多个平台')
  .version(pkg.version, '-v, --version', '显示版本号');

program
  .option('--platforms <list>', '过滤 --list mcp 查询的平台（逗号分隔）')
  .option('--source <path>', '源配置文件路径', path.join(os.homedir(), '.opencodex', 'config.json'))
  .option('--dry-run', '预览模式，不实际写入（--config 同步与 --import-mcp 共用）')
  .option('--enable-vision', '强制把所有模型标记为支持视觉（--list models 用）')
  .option('--verbose', '显示详细信息')
  .option('--list <kinds>', '列出配置: platforms/models/mcp/metadata（逗号分隔，如 --list mcp,platforms；all=全部），支持 --json')
  .option('--config <json|path>', '用 JSON 配置驱动同步（JSON 字符串或文件路径），替代多个同步 flag；支持 --json')
  .option('--import-mcp', '合并各平台 MCP 配置到源 mcp.json（同名保留源配置，供 --list mcp 显示全集）')
  .option('--force-mcp', '强制重置 MCP：目标平台现有但不在本次同步列表的服务器全部禁用/移除（配 --config 使用）')
  .option('--json', '与 --list / --config / --import-mcp 一起使用时输出 JSON 格式')
  .action(async (options) => {
    try {
      // 统一查询入口（--list platforms,models,mcp,metadata [--json]）
      if (options.list) {
        let kinds = options.list.split(',').map(s => s.trim()).filter(Boolean);
        if (kinds.includes('all')) kinds = ['platforms', 'models', 'mcp', 'metadata'];

        // JSON 模式：静音 console，保证 stdout 只输出 JSON（fetchModels 内部有日志）
        const origLog = console.log;
        const origWarn = console.warn;
        if (options.json) {
          console.log = () => {};
          console.warn = () => {};
        }
        try {
          const out = {};
          for (const kind of kinds) {
            switch (kind) {
              case 'platforms':
                out.platforms = fetchPlatforms();
                if (!options.json) printPlatforms(out.platforms);
                break;
              case 'models':
                out.models = await fetchModels(options);
                if (!options.json) printModels(out.models);
                break;
              case 'mcp':
                out.mcp = fetchMcpList(options);
                if (!options.json) printMcpList(out.mcp);
                break;
              case 'metadata':
                if (options.json) {
                  out.metadata = metadataStatus();
                } else {
                  console.log('\n🔄 更新元数据缓存...');
                  out.metadata = await refreshMetadata();
                  console.log(`✓ 元数据缓存: ${out.metadata.modelCount} 个模型`);
                }
                break;
              default:
                throw new Error(`未知列表类型: ${kind}（可用: platforms, models, mcp, metadata, all）`);
            }
          }
          if (options.json) {
            console.log = origLog;
            console.warn = origWarn;
            console.log(JSON.stringify(out, null, 2));
          }
        } catch (e) {
          if (options.json) {
            console.log = origLog;
            console.warn = origWarn;
          }
          throw e;
        }
        return;
      }

      // JSON 配置驱动同步（--config '<json>' 或 --config sync.json；--dry-run 可叠加）
      // 矩阵不再短路：有 mcp.matrix 时模型照常同步，MCP 改用矩阵驱动（runFullSync 内处理）
      if (options.config) {
        const cfg = parseConfigOption(options.config);
        const jsonOut = options.json || cfg.json === true;
        const dryRun = cfg.dryRun === true || options.dryRun === true;
        // JSON 模式：静音 console，保证 stdout 只输出 JSON（runFullSync/load 内部有日志）
        const origLog = console.log;
        const origWarn = console.warn;
        if (jsonOut) {
          console.log = () => {};
          console.warn = () => {};
        }
        let result;
        try {
          result = await runFullSync({
            mode: cfg.mode || 'all',
            all: cfg.all === true,
            platforms: Array.isArray(cfg.platforms) ? cfg.platforms : null,
            mcpPlatforms: Array.isArray(cfg.mcp?.platforms) ? cfg.mcp.platforms : null,
            mcpExclude: Array.isArray(cfg.mcp?.exclude) ? cfg.mcp.exclude : [],
            perPlatformMcpExclude: Object.fromEntries(
              Object.entries(cfg.mcp?.excludeFor || {}).map(([p, names]) => [p, new Set(Array.isArray(names) ? names : [])])
            ),
            mcpMatrix: cfg.mcp?.matrix || null,
            dryRun,
            source: cfg.source || options.source,
            enableVision: cfg.enableVision === true,
            // forceMcp 默认 false（CLI 增量语义）；UI 通过 sync.json 显式写 true 开启重置
            forceMcp: cfg.forceMcp === true || options.forceMcp === true
          });
        } finally {
          if (jsonOut) {
            console.log = origLog;
            console.warn = origWarn;
          }
        }
        if (jsonOut) {
          console.log(JSON.stringify(result, null, 2));
        }
        process.exit(result.failCount > 0 ? 1 : 0);
        return;
      }


      // 合并各平台 MCP 配置到源 mcp.json（--import-mcp [--dry-run] [--json]）
      if (options.importMcp) {
        const src = resolveSourceMcp();
        if (!src) {
          throw new Error('源 mcp.json 不存在（cwd/mcp.json 或 ~/.unifyai/mcp.json）');
        }
        const cfg = JSON.parse(fs.readFileSync(src.path, 'utf-8'));
        if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};

        const added = [];
        const mergedSet = new Set();
        for (const [id, AdapterClass] of Object.entries(ADAPTERS)) {
          const adapter = new AdapterClass();
          const servers = adapter.getMcpServers();
          if (servers === null) continue; // 该平台不支持读取（Reasonix）
          for (const s of servers) {
            if (cfg.mcpServers[s.name]) {
              mergedSet.add(s.name); // 同名保留源配置（源是权威）
              continue;
            }
            const converted = platformConfigToMcpJson(id, s.config);
            if (!converted) continue;
            cfg.mcpServers[s.name] = converted;
            added.push(s.name);
          }
        }
        const merged = [...mergedSet];

        if (!options.dryRun) {
          fs.writeFileSync(src.path, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
        }

        const result = {
          source: src.path,
          added,
          merged,
          total: Object.keys(cfg.mcpServers).length,
          dryRun: !!options.dryRun
        };
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`\n${options.dryRun ? '[预览] ' : ''}源 mcp.json (${src.path})`);
          if (added.length > 0) console.log(`  + 新增 ${added.length} 个: ${added.join(', ')}`);
          if (merged.length > 0) console.log(`  = 同名保留 ${merged.length} 个: ${merged.join(', ')}`);
          console.log(`  ✓ 总计 ${result.total} 个服务器${options.dryRun ? '（未写入）' : ''}`);
        }
        return;
      }


      // 默认全量同步（无任何子命令时；--dry-run 预览，--force-mcp 强制重置 MCP）
      const result = await runFullSync({
        mode: 'all',
        all: false,
        platforms: options.platforms ? options.platforms.split(',').map(p => p.trim()) : null,
        mcpPlatforms: null,
        mcpExclude: [],
        perPlatformMcpExclude: {},
        dryRun: options.dryRun === true,
        source: options.source,
        enableVision: options.enableVision === true,
        forceMcp: options.forceMcp === true
      });
      process.exit(result.failCount > 0 ? 1 : 0);
    } catch (error) {
      console.error('\n❌ 错误:', error.message);
      
      if (options.verbose) {
        console.error(error.stack);
      }
      
      process.exit(1);
    }
  });

program.parse();
