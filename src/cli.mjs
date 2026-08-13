#!/usr/bin/env node

/**
 * cli.mjs
 * AI Config Sync - CLI 主入口
 */

import { Command } from 'commander';
import path from 'node:path';
import os from 'node:os';
import { ConfigLoader } from './core/config-loader.mjs';
import { MetadataFetcher } from './core/metadata-fetcher.mjs';
import { OpenCodeAdapter } from './adapters/opencode-adapter.mjs';
import { CodexAdapter } from './adapters/codex-adapter.mjs';
import { ClaudeCodeAdapter } from './adapters/claude-code-adapter.mjs';
import { ReasonixAdapter } from './adapters/reasonix-adapter.mjs';

// 可用的适配器
const ADAPTERS = {
  opencode: OpenCodeAdapter,
  codex: CodexAdapter,
  claudecode: ClaudeCodeAdapter,
  reasonix: ReasonixAdapter
};

const program = new Command();

program
  .name('ai-sync')
  .description('同步 AI 配置到多个平台')
  .version('1.0.0');

program
  .option('--all', '同步到所有平台')
  .option('--platforms <list>', '指定平台（逗号分隔）', 'opencode,codex,claudecode,reasonix')
  .option('--models-only', '仅同步模型配置')
  .option('--mcp-only', '仅同步 MCP 配置')
  .option('--dry-run', '预览模式，不实际写入')
  .option('--source <path>', '源配置文件路径', path.join(os.homedir(), '.opencodex', 'config.json'))
  .option('--list-platforms', '列出支持的平台')
  .option('--update-metadata', '更新元数据缓存（从 OpenRouter 获取）')
  .option('-v, --verbose', '显示详细信息')
  .action(async (options) => {
    try {
      // 列出支持的平台
      if (options.listPlatforms) {
        console.log('\n📋 支持的平台:\n');
        for (const [name, AdapterClass] of Object.entries(ADAPTERS)) {
          const adapter = new AdapterClass();
          const modelSupport = adapter.supportsModels ? '✓' : '✗';
          const mcpSupport = adapter.supportsMcp ? '✓' : '✗';
          console.log(`  ${name.padEnd(12)} 模型: ${modelSupport}  MCP: ${mcpSupport}`);
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

      // 标准化 MCP 配置
      const mcpServers = ConfigLoader.normalizeMcp(config.mcp);

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

        try {
          if (options.dryRun) {
            console.log(`\n📦 [预览] ${platformName}...`);
            console.log(`  配置文件: ${adapter.getConfigPath()}`);
            
            if (!options.mcpOnly && adapter.supportsModels) {
              console.log(`  → 将同步 ${config.models.length} 个模型`);
            }
            
            if (!options.modelsOnly && adapter.supportsMcp) {
              console.log(`  → 将同步 ${Object.keys(mcpServers).length} 个 MCP 服务器`);
            }
            
            successCount++;
          } else {
            await adapter.sync(
              {
                models: config.models,
                mcp: mcpServers
              },
              {
                modelsOnly: options.modelsOnly,
                mcpOnly: options.mcpOnly
              }
            );
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
