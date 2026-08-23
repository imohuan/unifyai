#!/usr/bin/env node
/**
 * proxy-test.mjs
 * 模拟 config-loader.mjs 的 tryFetchFromProxy，多次请求测代理可用性
 * 用法: node test/proxy-test.mjs [次数] [超时ms]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROUNDS = parseInt(process.argv[2] || '10', 10);
const TIMEOUT_MS = parseInt(process.argv[3] || '3000', 10);

// 读取配置（和 config-loader 一致）
const configPath = path.join(os.homedir(), '.opencodex', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const port = config.port || 10100;
const proxyUrl = `http://localhost:${port}/v1/models`;

// API key 逻辑（和 config-loader 一致）
let proxyApiKey = null;
if (Array.isArray(config.apiKeys) && config.apiKeys.length > 0) {
  proxyApiKey = config.apiKeys[0].key || null;
} else if (process.env.OPENCODEX_API_AUTH_TOKEN) {
  proxyApiKey = process.env.OPENCODEX_API_AUTH_TOKEN;
}

// 复制 tryFetchFromProxy 逻辑，但把失败原因暴露出来
async function tryFetch(round) {
  const t0 = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const headers = { 'Content-Type': 'application/json' };
    if (proxyApiKey) {
      headers['x-opencodex-api-key'] = proxyApiKey;
      headers['Authorization'] = `Bearer ${proxyApiKey}`;
    }

    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const elapsed = Date.now() - t0;

    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status} ${response.statusText}`, elapsed };
    }

    const data = await response.json();
    if (!data.data || !Array.isArray(data.data)) {
      return { ok: false, reason: `响应缺少 data 数组，keys=[${Object.keys(data)}]`, elapsed };
    }

    return { ok: true, count: data.data.length, elapsed, sample: data.data.slice(0, 3).map(m => m.id) };
  } catch (error) {
    const elapsed = Date.now() - t0;
    const name = error?.name || '';
    let reason = error?.message || String(error);
    if (name === 'AbortError' || reason.includes('abort')) {
      reason = `超时(${TIMEOUT_MS}ms): fetch 被 AbortController 中断`;
    } else if (reason.includes('ECONNREFUSED') || reason.includes('connect')) {
      reason = `连接被拒绝(ECONNREFUSED): 代理服务没在监听 ${proxyUrl}`;
    } else if (reason.includes('ENOTFOUND') || reason.includes('EAI_AGAIN')) {
      reason = `DNS 解析失败(ENOTFOUND): 无法解析 localhost`;
    }
    return { ok: false, reason: `${name}: ${reason}`, elapsed };
  }
}

// 先探测 hostname 解析（Node 里 localhost 可能优先解析成 ::1）
async function probeDns() {
  try {
    const dns = await import('node:dns');
    const result = await dns.promises.lookup('localhost', { all: true });
    console.log(`DNS: localhost -> ${JSON.stringify(result)}`);
  } catch (e) {
    console.log('DNS probe failed:', e.message);
  }
}

console.log(`=== OpenCodex 代理可用性测试 ===`);
console.log(`URL: ${proxyUrl}`);
console.log(`API key: ${proxyApiKey ? proxyApiKey.slice(0, 12) + '...' : '(无)'}`);
console.log(`轮数: ${ROUNDS}, 超时: ${TIMEOUT_MS}ms\n`);

await probeDns();

let ok = 0, fail = 0;
const failReasons = new Map();

for (let i = 1; i <= ROUNDS; i++) {
  const r = await tryFetch(i);
  if (r.ok) {
    ok++;
    console.log(`[${i}/${ROUNDS}] ✓ 成功 ${r.count} 个模型 (${r.elapsed}ms) 样例: ${r.sample?.join(', ')}`);
  } else {
    fail++;
    failReasons.set(r.reason, (failReasons.get(r.reason) || 0) + 1);
    console.log(`[${i}/${ROUNDS}] ✗ 失败 (${r.elapsed}ms): ${r.reason}`);
  }
  // 模拟真实使用间隔
  await new Promise(res => setTimeout(res, 200));
}

console.log(`\n=== 结果: ${ok}/${ROUNDS} 成功, ${fail}/${ROUNDS} 失败 ===`);
if (failReasons.size) {
  console.log('失败原因分布:');
  for (const [reason, count] of failReasons) {
    console.log(`  - ${reason} (x${count})`);
  }
}
