# Writeback & Receipt（Skills 共享）

> 完整契约：`TOOLS.md` §Writeback Contract。耐久主写统一 `lib/writeback-engine`（Desktop WorkspaceService / UTR / AI → Kernel 写闸 **Done**，见 `docs/ARCHITECTURE-RESET.md` §2.2）。

## 保存设置

```yaml
writeback:
  mode: auto | confirm   # 仅此两档；无 batch mode
```

| 模式 | 行为 |
|------|------|
| `auto` | 直接写入，返回路径回执；危险操作可逆（`99-归档/`） |
| `confirm` | 写入前进入目标/内容审阅入口 |

用户话术：

- **自动保存** → `auto`  
- **保存前问我** → `confirm`  

**主动建议 ≠ 自动写**：系统可默认生成建议卡片；执行高影响写入仍须确认 + protection。  
优先级：`protection`（open|locked）> `writeback.mode`。

## 回执最小字段

```text
已收进/已更新：大类 → 专题（或单篇 / Inbox）
位置：relative/path.md
操作：create | update | delete | archive | restore
保存模式：auto | confirm
判断：信心与理由（如有）
下一步：继续写 / 整理 / 写入专题记忆 / 手动移动
```

写入必须返回 **target path + affected files**（UTR 时见 WritebackEvidence）。

## 可逆性

- 删除 → 移入系统归档 trash，不永久抹除  
- 整文替换 → 保留 snapshot / 备份  
- 锁定/定稿文件 → 新建修订副本，不原地改  
