# Writeback & Receipt（Skills 共享）

> 完整契约：`TOOLS.md` §Writeback Contract。耐久主写统一 `lib/writeback-engine`（Desktop WorkspaceService / UTR / AI → Kernel 写闸 **Done**，见 `docs/ARCHITECTURE-RESET.md` §2.2）。

## 保存设置

```yaml
writeback:
  mode: auto | confirm   # 仅此两档；无 batch mode
```

| 模式 | 行为 |
|------|------|
| `auto` | 直接写入；**高影响**才备份/回执（locked 覆盖 · 锁定/核心 delete）；archive 迁入现场 **role:system** 目录当新家（常为 `99-归档` / `99-Archive`）；普通开放笔记删除无 trash |
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

## 可逆性（高影响 only）

- 锁定 / 核心笔记删除 / 归档 → 移入现场 system 目录的 `backups/trash`（或归档副本）+ 回执；普通开放笔记删除无 trash；`permanent` 则无副本  
- **locked** 既有文件覆盖 → 旋转备份 + 回执  
- 常规 **open** 更新 → 不造备份/回执（不伪造路径）；证据仍含 target path + affected files  
- AI 不得直接写 locked；须 fork 或用户解锁  

## 错误处理（共享）

写入失败时不得静默丢弃数据。按以下优先级处理：

| 错误类型 | 处理 |
|---------|------|
| 磁盘满 / 权限不足 | 报错 + 已备回复制位置；不静默丢数据 |
| 路径过长 / 非法字符 | 提示用户缩短专题名或使用合法字符 |
| `protection: locked` | 拒绝写入 + 建议 fork 修订版 |
| 工作区无 `topmind.yaml` | 按默认契约解释 + 回执标注「默认契约」 |
| UTR 不可用 | 降级为 Host 文件工具（见 `capability-degradation.md`） |
| 网络抓取失败 | 保留 URL + 摘录；不假装已成功 capture |
| AI 分析失败 | 诚实报错不写；不生成占位符假装成功 |
| 源文件不存在（promote） | 报错 + 路径；不静默跳过 |
| 参数缺失 / 值非法 | 明确报错指出缺失字段或非法值；不猜测默认 |
| 周期本解析失败 | 回退为新建文件 + 回执标注「新建周期本」 |
