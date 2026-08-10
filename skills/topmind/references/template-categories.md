# Template-Driven Categories + WorkspaceModel

topmind 使用**模板驱动默认角色** + **配置扩展** + **FS 自发现**。

读 `{workspace}/topmind.yaml`：

- `template` → `templates/{id}.json` 出厂类别  
- `categories.extensions` → 用户新增一级类的角色/行为  
- `categories.overrides` → 对已有 slot 的覆盖（含 hidden）  

解析实现：`lib/workspace-model.mjs` → `resolveWorkspaceModel`。

## Roles

| Role | Purpose | Skills |
|------|---------|--------|
| `buffer` | Inbox — 未归类 | capture 兜底；loop inbox scope |
| `loose-stream` | 持续流，默认平铺 | capture / organize；低密度 memory |
| `deep-work` | 研究 / 创作 | capture / organize；高密度 memory |
| `fallback` | 兜底，定期清理 | maintain 提醒 |
| `reference` | 反复引用素材 | connector 目标；少改 memory |
| `delivery` | 交付物扁平层 | write `save-output` |
| `system` | 归档 / 备份 | maintain；可逆性 |

## Template 参数化规约

| 规约 | 模板 / 扩展属性 |
|------|----------------|
| 专题涌现 | `minNotes`（默认 2） |
| 松散流 | `specialBehavior: "flat-default"` |
| 兜底清理 | `catchAll: true` + `retentionDays` |
| 参考资料 | `referenceOnly: true` |

角色驱动路由，**不要硬编码** `10-` / `20-` 等具体编号（目录名以工作区为准）。

## Dynamic discovery

任意匹配 `{NN}[- ]{Name}/` 的目录均为类别。用户可扩展；系统扫描根目录发现。  
自定义类若无 config/template 属性 → 默认 `role: deep-work`（可通过 Desktop 设置或写 `categoryExtensions` 声明）。

## list-categories 字段

UTR / Desktop 返回同一语义：

`slot` · `name` · `directory` · `role` · `specialBehavior` · `source` · `ok` · `hidden`  
