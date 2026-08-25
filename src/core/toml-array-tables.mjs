#!/usr/bin/env node

/**
 * toml-array-tables.mjs
 * 
 * 支持 TOML 数组表格式 [[section]] 的解析和生成工具
 * 用于 Reasonix 等需要数组表的平台
 * 
 * 主要功能：
 * - tomlToJson(text): 解析 TOML，支持 [[array_tables]]
 * - jsonToToml(json): 生成 TOML，支持 [[array_tables]]
 */

/**
 * 解析 TOML 文本，支持数组表格式 [[section]]
 * @param {string} text - TOML 文本
 * @returns {object} 嵌套的 JSON 对象
 */
export function tomlToJson(text) {
  const lines = text.split('\n');
  const result = {};
  let currentSection = null;
  let currentArray = null;  // 当前数组表的名称
  let currentArrayItem = null;  // 当前数组项
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
      if (/^\s*\]\s*$/.test(line)) {
        const target = currentArrayItem || currentSection ? 
          (currentArrayItem || getNestedObject(result, currentSection)) : result;
        target[multilineKey] = parseValue(multilineValue);
        multilineValue = null;
        multilineKey = null;
      }
      continue;
    }

    // 检测数组表头 [[section]]
    const arrayTableMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayTableMatch) {
      const arrayName = arrayTableMatch[1];
      
      // 初始化数组如果不存在
      if (!result[arrayName]) {
        result[arrayName] = [];
      }
      
      // 创建新的数组项
      currentArrayItem = {};
      result[arrayName].push(currentArrayItem);
      currentArray = arrayName;
      currentSection = null;
      continue;
    }

    // 检测普通 section [section]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      currentArray = null;
      currentArrayItem = null;
      
      // 创建嵌套对象路径
      const parts = currentSection.split('.');
      let obj = result;
      for (const part of parts) {
        if (!obj[part]) obj[part] = {};
        obj = obj[part];
      }
      continue;
    }

    // 解析键值对
    const kvMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value = kvMatch[2].trim();
      
      // 移除行尾的注释
      // 需要找到值的真实结尾（']' 或 '"' 或其他），然后移除之后的注释
      if (value.startsWith('[')) {
        // 处理数组值
        let bracketCount = 0;
        let inString = false;
        let escaped = false;
        let endIndex = -1;
        
        for (let j = 0; j < value.length; j++) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (value[j] === '\\' && inString) {
            escaped = true;
            continue;
          }
          if (value[j] === '"') {
            inString = !inString;
            continue;
          }
          if (!inString) {
            if (value[j] === '[') bracketCount++;
            else if (value[j] === ']') {
              bracketCount--;
              if (bracketCount === 0) {
                endIndex = j;
                break;
              }
            }
          }
        }
        
        if (endIndex !== -1) {
          const afterBracket = value.substring(endIndex + 1).trim();
          if (afterBracket.startsWith('#')) {
            value = value.substring(0, endIndex + 1);
          }
        }
      } else if (value.startsWith('{')) {
        // 处理内联表值
        let braceCount = 0;
        let inString = false;
        let escaped = false;
        let endIndex = -1;
        
        for (let j = 0; j < value.length; j++) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (value[j] === '\\' && inString) {
            escaped = true;
            continue;
          }
          if (value[j] === '"') {
            inString = !inString;
            continue;
          }
          if (!inString) {
            if (value[j] === '{') braceCount++;
            else if (value[j] === '}') {
              braceCount--;
              if (braceCount === 0) {
                endIndex = j;
                break;
              }
            }
          }
        }
        
        if (endIndex !== -1) {
          const afterBrace = value.substring(endIndex + 1).trim();
          if (afterBrace.startsWith('#')) {
            value = value.substring(0, endIndex + 1);
          }
        }
      } else if (value.startsWith('"')) {
        // 处理字符串值
        let endQuoteIndex = -1;
        let escaped = false;
        for (let j = 1; j < value.length; j++) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (value[j] === '\\') {
            escaped = true;
            continue;
          }
          if (value[j] === '"') {
            endQuoteIndex = j;
            break;
          }
        }
        if (endQuoteIndex !== -1) {
          const afterQuote = value.substring(endQuoteIndex + 1).trim();
          if (afterQuote.startsWith('#')) {
            value = value.substring(0, endQuoteIndex + 1);
          }
        }
      } else {
        // 处理其他值（数字、布尔值等）
        const commentIndex = value.indexOf('#');
        if (commentIndex !== -1) {
          value = value.substring(0, commentIndex).trim();
        }
      }

      // 检测多行数组/内联表
      if ((value.startsWith('[') && !value.endsWith(']')) ||
          (value.startsWith('{') && !value.endsWith('}'))) {
        multilineValue = value;
        multilineKey = key;
      } else {
        // 确定目标对象
        let target;
        if (currentArrayItem) {
          target = currentArrayItem;
        } else if (currentSection) {
          target = getNestedObject(result, currentSection);
        } else {
          target = result;
        }
        
        target[key] = parseValue(value);
      }
    }
  }

  return result;
}

/**
 * 获取嵌套对象
 */
function getNestedObject(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (!current[part]) current[part] = {};
    current = current[part];
  }
  return current;
}

/**
 * 生成 TOML 文本，支持数组表格式
 * @param {object} json - 嵌套的 JSON 对象
 * @returns {string} TOML 文本
 */
export function jsonToToml(json) {
  const lines = [];
  const processedKeys = new Set();

  // 处理顶层键值对（非数组、非对象）
  for (const [key, value] of Object.entries(json)) {
    if (typeof value !== 'object' || value === null) {
      lines.push(`${key} = ${formatValue(value)}`);
      processedKeys.add(key);
    }
  }

  // 处理普通 section（对象但不是数组）
  for (const [key, value] of Object.entries(json)) {
    if (processedKeys.has(key)) continue;
    if (!Array.isArray(value) && typeof value === 'object' && value !== null) {
      lines.push('');
      lines.push(`[${key}]`);
      for (const [k, v] of Object.entries(value)) {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) {
          lines.push(`${k} = ${formatValue(v)}`);
        }
      }
      processedKeys.add(key);
    }
  }

  // 处理数组表 [[section]]
  for (const [key, value] of Object.entries(json)) {
    if (processedKeys.has(key)) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        lines.push('');
        lines.push(`[[${key}]]`);
        for (const [k, v] of Object.entries(item)) {
          // 包括所有值：字符串、数字、布尔值、数组
          if (v !== null && v !== undefined) {
            lines.push(`${k} = ${formatValue(v)}`);
          }
        }
      }
      processedKeys.add(key);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * 解析单个 TOML 值
 */
function parseValue(value) {
  value = value.trim();

  // 布尔值
  if (value === 'true') return true;
  if (value === 'false') return false;

  // 数组
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

    const trimmed = current.trim();
    if (trimmed) items.push(parseValue(trimmed));
    return items;
  }

  // 字符串：需要先移除引号，再反转义
  if (value.startsWith('"') && value.endsWith('"')) {
    const strValue = value.slice(1, -1);
    return unescapeString(strValue);
  }

  // 数字
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return value.includes('.') ? parseFloat(value) : parseInt(value, 10);
  }

  // 内联表
  if (value.startsWith('{') && value.endsWith('}')) {
    const result = {};
    const inner = value.slice(1, -1).trim();
    if (inner) {
      const pairs = inner.split(',');
      for (const pair of pairs) {
        const match = pair.trim().match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
        if (match) {
          result[match[1]] = parseValue(match[2].trim());
        }
      }
    }
    return result;
  }

  return value;
}

/**
 * 反转义字符串
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
 */
function formatValue(value) {
  if (value === null || value === undefined) {
    return '""';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[ ]';
    const items = value.map(item => formatValue(item));
    return `[ ${items.join(', ')} ]`;
  }

  if (typeof value === 'object' && value !== null) {
    const pairs = [];
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string') {
        pairs.push(`${k} = "${escapeString(v)}"`);
      } else {
        pairs.push(`${k} = ${formatValue(v)}`);
      }
    }
    return `{ ${pairs.join(', ')} }`;
  }

  // 字符串：使用 escapeString 函数进行正确的转义
  return `"${escapeString(String(value))}"`;
}

/**
 * 转义字符串
 */
function escapeString(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
}
