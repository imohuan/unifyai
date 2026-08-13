#!/usr/bin/env node

/**
 * codex-toml — 纯手工 TOML ↔ JSON 转换工具
 * 
 * 提供两个核心函数：
 * - tomlToJson(text): 将 TOML 文本解析为嵌套 JSON 对象
 * - jsonToToml(json): 将嵌套 JSON 对象序列化为 TOML 文本
 * 
 * 不依赖任何 TOML 库，不关心 Codex 特定业务逻辑。
 */

/**
 * 将 TOML 文本解析为嵌套 JSON 对象
 * @param {string} text - TOML 文本
 * @returns {object} 嵌套的 JSON 对象
 */
export function tomlToJson(text) {
  const lines = text.split('\n');
  const result = {};
  let currentPath = [];
  let currentObj = result;
  let multilineValue = null;
  let multilineKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 如果正在收集多行值
    if (multilineValue !== null) {
      multilineValue += '\n' + line;
      // 检查多行值是否结束（数组以 ] 结尾的行）
      if (/^\s*\]\s*$/.test(line)) {
        currentObj[multilineKey] = parseValue(multilineValue);
        multilineValue = null;
        multilineKey = null;
      }
      continue;
    }

    // 检测 section header: [a.b.c]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const path = sectionMatch[1].split('.');
      currentPath = path;
      
      // 创建嵌套对象路径
      currentObj = result;
      for (const key of path) {
        if (!currentObj[key]) currentObj[key] = {};
        currentObj = currentObj[key];
      }
      continue;
    }

    // 解析键值对
    const kvMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();

      // 检测多行数组/内联表: key = [ 但不以 ] 结尾
      if ((value.startsWith('[') && !value.endsWith(']')) ||
          (value.startsWith('{') && !value.endsWith('}'))) {
        multilineValue = value;
        multilineKey = key;
      } else {
        currentObj[key] = parseValue(value);
      }
    }
  }

  return result;
}

/**
 * 将嵌套 JSON 对象序列化为 TOML 文本
 * @param {object} json - 嵌套的 JSON 对象
 * @returns {string} TOML 文本
 */
export function jsonToToml(json) {
  const sections = [];
  
  // 先处理顶层键值对（不在任何 section 中）
  const topLevelLines = [];
  for (const [key, value] of Object.entries(json)) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      topLevelLines.push(`${key} = ${formatValue(value)}`);
    }
  }
  if (topLevelLines.length > 0) {
    sections.push(topLevelLines.join('\n'));
  }

  // 递归处理嵌套对象为 section
  function processSection(obj, path = []) {
    const lines = [];
    const nestedSections = [];

    // 分离当前层级的键值对和嵌套对象
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        // 跳过 null/undefined
        continue;
      }

      if (typeof value === 'object' && !Array.isArray(value)) {
        // 嵌套对象：记录为子 section
        nestedSections.push([key, value]);
      } else {
        // 普通键值对
        lines.push(`${key} = ${formatValue(value)}`);
      }
    }

    // 如果当前层级有键值对，生成 section
    if (lines.length > 0 && path.length > 0) {
      const sectionHeader = `[${path.join('.')}]`;
      sections.push(sectionHeader + '\n' + lines.join('\n'));
    }

    // 递归处理子 section
    for (const [key, value] of nestedSections) {
      processSection(value, [...path, key]);
    }
  }

  // 处理顶层对象
  for (const [key, value] of Object.entries(json)) {
    if (typeof value === 'object' && !Array.isArray(value)) {
      processSection(value, [key]);
    }
  }

  return sections.join('\n\n') + '\n';
}

/**
 * 解析单个 TOML 值
 * @param {string} value - 值字符串
 * @returns {any} 解析后的值
 */
function parseValue(value) {
  value = value.trim();

  // 布尔值
  if (value === 'true') return true;
  if (value === 'false') return false;

  // 数组: [ "a", "b", "c" ]
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    
    const items = [];
    let current = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < inner.length; i++) {
      const char = inner[i];

      if (escaped) {
        // 处理转义字符
        if (char === '\\') current += '\\';
        else if (char === '"') current += '"';
        else if (char === 'n') current += '\n';
        else if (char === 't') current += '\t';
        else current += char;
        escaped = false;
        continue;
      }

      if (char === '\\' && inString) {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (char === ',' && !inString) {
        const trimmed = current.trim();
        if (trimmed) items.push(parseValue(trimmed));
        current = '';
        continue;
      }

      current += char;
    }

    // 添加最后一项
    const trimmed = current.trim();
    if (trimmed) items.push(parseValue(trimmed));

    return items;
  }

  // 字符串: "value"
  if (value.startsWith('"') && value.endsWith('"')) {
    return unescapeString(value.slice(1, -1));
  }

  // 数字
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return value.includes('.') ? parseFloat(value) : parseInt(value, 10);
  }

  // 其他情况返回原始字符串
  return value;
}

/**
 * 反转义字符串（读取时）
 * @param {string} str - 转义的字符串
 * @returns {string} 反转义后的字符串
 */
function unescapeString(str) {
  let result = '';
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (escaped) {
      if (char === '\\') result += '\\';
      else if (char === '"') result += '"';
      else if (char === 'n') result += '\n';
      else if (char === 't') result += '\t';
      else if (char === 'r') result += '\r';
      else result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * 格式化值为 TOML 格式
 * @param {any} value - 要格式化的值
 * @returns {string} TOML 格式的字符串
 */
function formatValue(value) {
  // null 或 undefined
  if (value === null || value === undefined) {
    return '""';
  }

  // 布尔值
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  // 数字
  if (typeof value === 'number') {
    return String(value);
  }

  // 数组
  if (Array.isArray(value)) {
    if (value.length === 0) return '[ ]';
    const items = value.map(item => formatValue(item));
    return `[ ${items.join(', ')} ]`;
  }

  // 对象（不应该出现在这里，应该作为 section 处理）
  if (typeof value === 'object') {
    return '""';
  }

  // 字符串（默认情况）
  return `"${escapeString(String(value))}"`;
}

/**
 * 转义字符串（写入时）
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
function escapeString(str) {
  return str
    .replace(/\\/g, '\\\\')  // \ → \\
    .replace(/"/g, '\\"')    // " → \"
    .replace(/\n/g, '\\n')   // 换行 → \n
    .replace(/\t/g, '\\t')   // 制表符 → \t
    .replace(/\r/g, '\\r');  // 回车 → \r
}
