# MCP 增量同步测试

## 测试场景

假设 PenguinHarness 的 `system_config.yaml` 中已有以下 MCP 配置：

```yaml
tools:
  mcpServers:
    - name: baizhi_juhe
      config:
        transport: http
        url: https://old-gateway.example.com
        headers:
          Authorization: Bearer old-token
    - name: existing_server
      config:
        transport: stdio
        command: some-command
```

## 同步源配置

从 OpenCodex 同步以下 MCP 配置：

```json
{
  "baizhi_juhe": {
    "transport": "http",
    "url": "https://mcp-gateway.app.baizhi.cloud/mcp/gateway-xxx",
    "headers": {
      "Authorization": "Bearer sk-new-token"
    }
  },
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:/Code"]
  }
}
```

## 预期结果

同步后的 `system_config.yaml` 应该为：

```yaml
tools:
  mcpServers:
    - name: baizhi_juhe
      config:
        transport: http
        url: https://mcp-gateway.app.baizhi.cloud/mcp/gateway-xxx  # 已更新
        headers:
          Authorization: Bearer sk-new-token  # 已更新
    - name: existing_server  # 保留原有配置
      config:
        transport: stdio
        command: some-command
    - name: filesystem  # 新增
      config:
        transport: stdio
        command: npx
        args:
          - "-y"
          - "@modelcontextprotocol/server-filesystem"
          - "D:/Code"
```

## 同步逻辑

1. **保留**: `existing_server` 保持不变（不在同步源中）
2. **更新**: `baizhi_juhe` 以新配置覆盖旧配置
3. **新增**: `filesystem` 作为新服务器添加

## 控制台输出示例

```
📦 同步到 PenguinHarness...
  → 同步 MCP 配置 (2 个)
    找到 3 个 system_config.yaml 文件
    → 更新: default_project/agents/default_agent/agent_state/system_config.yaml
      ↻ 更新: baizhi_juhe
      + 新增: filesystem
      ✓ 完成: 新增 1 个, 更新 1 个
    → 更新: my_project/agents/custom_agent/agent_state/system_config.yaml
      ↻ 更新: baizhi_juhe
      + 新增: filesystem
      ✓ 完成: 新增 1 个, 更新 1 个
    完成: 3 成功, 0 失败
  ✓ MCP 同步完成
```

## 优势

1. **非破坏性**: 不会删除用户手动添加的 MCP 服务器
2. **增量更新**: 只更新需要同步的服务器
3. **覆盖策略**: 同名服务器以最新配置为准
4. **清晰日志**: 明确显示哪些是新增，哪些是更新
