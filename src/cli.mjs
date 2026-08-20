#!/usr/bin/env node

/**
 * cli.mjs
 * AI Config Sync - CLI 主入口
 */

import { Command } from 'commander';
import path from 'node:path';
import os from 'node:os';
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

program
  .name('unifyai')
  .description('同步 AI 配置到多个平台')
  .version(pkg.version, '-v, --version', '显示版本号');

program
  .option('--all', '同步到所有平台')
  .option('--platforms <list>', '指定平台（逗号分隔）', 'opencode,codex,claudecode,reasonix,penguin')
  .option('--models-only', '仅同步模型配置')
  .option('--mcp-only', '仅同步 MCP 配置')
  .option('--mcp-platforms <list>', '仅对指定平台同步 MCP（逗号分隔），其他平台跳过 MCP')
  .option('--mcp-exclude <names>', '所有平台都排除的 MCP 服务器（逗号分隔）')
  .option('--mcp-exclude-for <platform=names>', '仅对指定平台排除的 MCP 服务器（可多次指定，如 --mcp-exclude-for codex=node_env,github）', collect, [])
  .option('--dry-run', '预览模式，不实际写入')
  .option('--source <path>', '源配置文件路径', path.join(os.homedir(), '.opencodex', 'config.json'))
  .option('--list-platforms', '列出支持的平台')
  .option('--json', '与 --list-platforms 一起使用时输出 JSON 格式')
  .option('--update-metadata', '更新元数据缓存（从 OpenRouter 获取）')
  .option('--verbose', '显示详细信息')
  .action(async (options) => {
    try {
      // 列出支持的平台
      if (options.listPlatforms) {
        const platforms = Object.entries(ADAPTERS).map(([id, AdapterClass]) => {
          const adapter = new AdapterClass();
          return adapter.getInfo();
        });

        if (options.json) {
          console.log(JSON.stringify({ platforms }, null, 2));
          return;
        }

        // 人类可读输出
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
        return;
      }

      // 更新元数据缓存
      if (options.updateMetadata) {
        console.log('\n🔄 更新元数据缓存...');
        await MetadataFetcher.updateCache();
        console.log('✓ 元数据缓存已更新\n');
        return;
      }

      console.log('\n🚀 AI Config Sync - 配置同步工具\n');

      // 加载源配置（从每个 provider 获取模型列表）
      console.log(`📂 加载配置: ${options.source}`);
      const config = await ConfigLoader.load(options.source);

      // 标准化 MCP 配置（config.mcp 格式：{ mcpServers: {...} }）
      const mcpServers = config.mcp?.mcpServers 
        ? ConfigLoader.normalizeMcp(config.mcp.mcpServers)
        : {};

      // 增强模型元数据
      if (!options.mcpOnly && config.models.length > 0) {
        console.log('\n🔍 增强模型元数据...');
        config.models = await MetadataFetcher.enrich(config.models);
        console.log(`✓ ${config.models.length} 个模型元数据已增强`);
      }

      // 显示模型列表
      if (config.models.length > 0 && !options.mcpOnly) {
        console.log('\n📋 模型列表:');
        const grouped = {};
        for (const model of config.models) {
          if (!grouped[model.provider]) {
            grouped[model.provider] = [];
          }
          grouped[model.provider].push(model);
        }
        
        for (const [provider, models] of Object.entries(grouped)) {
          console.log(`\n  ${provider} (${models.length} 个模型):`);
          for (const model of models.slice(0, 10)) {
            const reasoning = model.supportsThinking ? '🧠' : '  ';
            const vision = model.supportsVision ? '👁️' : '  ';
            const ctx = model.contextWindow ? `${(model.contextWindow/1000).toFixed(0)}K` : '???';
            console.log(`    ${reasoning}${vision} ${model.modelId.padEnd(35)} [${ctx.padStart(6)}]`);
          }
          if (models.length > 10) {
            console.log(`    ... 还有 ${models.length - 10} 个模型`);
          }
        }
      }

      // 选择平台
      const platforms = options.all
        ? Object.keys(ADAPTERS)
        : options.platforms.split(',').map(p => p.trim());

      console.log(`\n🎯 目标平台: ${platforms.join(', ')}`);

      if (options.dryRun) {
        console.log('⚠️  预览模式：不会实际写入文件\n');
      }

      // 解析 MCP 排除规则
      const globalMcpExclude = new Set(
        (options.mcpExclude || '').split(',').map(s => s.trim()).filter(Boolean)
      );
      const perPlatformMcpExclude = {};
      const excludeForList = options.mcpExcludeFor || [];
      for (const entry of excludeForList) {
        const eqIdx = entry.indexOf('=');
        if (eqIdx === -1) continue;
        const platform = entry.slice(0, eqIdx).trim();
        const names = entry.slice(eqIdx + 1).split(',').map(s => s.trim()).filter(Boolean);
        if (!perPlatformMcpExclude[platform]) perPlatformMcpExclude[platform] = new Set();
        names.forEach(n => perPlatformMcpExclude[platform].add(n));
      }

      // MCP 平台白名单（--mcp-platforms），未指定则全部平台都同步 MCP
      const mcpPlatforms = options.mcpPlatforms
        ? options.mcpPlatforms.split(',').map(p => p.trim())
        : null;

      // 统计
      let successCount = 0;
      let failCount = 0;
      const errors = [];

      // 同步到各平台
      for (const platformName of platforms) {
        const AdapterClass = ADAPTERS[platformName];
        
        if (!AdapterClass) {
          console.warn(`\n⚠️  未知平台: ${platformName}`);
          failCount++;
          continue;
        }

        const adapter = new AdapterClass();

        // 按平台过滤 MCP 配置（--models-only 时 adapter 内部会跳过 MCP，这里过滤无副作用）
        let platformMcp = mcpServers;
        const excludedNames = [];
        // 平台白名单检查
        if (mcpPlatforms && !mcpPlatforms.includes(platformName)) {
          platformMcp = {};
          console.log(`\n  ⊘ ${platformName}: MCP 同步已跳过（不在 --mcp-platforms 白名单）`);
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

        try {
          if (options.dryRun) {
            console.log(`\n📦 [预览] ${platformName}...`);
            console.log(`  配置文件: ${adapter.getConfigPath()}`);
            
            if (!options.mcpOnly && adapter.supportsModels) {
              console.log(`  → 将同步 ${config.models.length} 个模型`);
            }
            
            if (!options.modelsOnly && adapter.supportsMcp) {
              const mcpCount = Object.keys(platformMcp).length;
              if (excludedNames.length > 0) {
                console.log(`  → 将同步 ${mcpCount} 个 MCP 服务器 (排除 ${excludedNames.join(', ')})`);
              } else {
                console.log(`  → 将同步 ${mcpCount} 个 MCP 服务器`);
              }
            }
            
            successCount++;
          } else {
            await adapter.sync(
              {
                models: config.models,
                mcp: platformMcp
              },
              {
                modelsOnly: options.modelsOnly,
                mcpOnly: options.mcpOnly
              }
            );
            if (excludedNames.length > 0) {
              console.log(`  ⊘ 已排除 MCP: ${excludedNames.join(', ')}`);
            }
            successCount++;
          }
        } catch (error) {
          failCount++;
          errors.push({ platform: platformName, error: error.message });
          console.error(`\n❌ ${platformName} 同步失败: ${error.message}`);
          
          if (options.verbose) {
            console.error(error.stack);
          }
        }
      }

      // 总结
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

      // 退出码
      process.exit(failCount > 0 ? 1 : 0);

    } catch (error) {
      console.error('\n❌ 错误:', error.message);
      
      if (options.verbose) {
        console.error(error.stack);
      }
      
      process.exit(1);
    }
  });

program.parse();
