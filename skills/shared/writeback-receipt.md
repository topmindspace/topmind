# Writeback & Receipt（Skills 共享）

> 完整契约：`TOOLS.md` §Writeback Contract。耐久主写统一 `lib/writeback-engine`（Desktop WorkspaceService / UTR / AI → Kernel 写闸 **Done**，见 `docs/ARCHITECTURE-RESET.md` §2.2）。  
> **2026-09-17 授权模型**：工作区围栏绝对；围栏内 agent 会话即授权；`locked` = 重要内容需**任务级首写快照**，不是 AI 禁区。

## 保存设置

```yaml
writeback:
  mode: auto | confirm   # 仅此两档；无 batch mode
```

| 模式 | 行为 |
|------|------|
| `auto` | 内容直接写入；locked 任务级首写快照；可恢复删/归档允许；archive 迁入现场 **role:system** 目录当新家；普通开放笔记删除无 trash |
| `confirm`（**分级**） | 内容新建/更新/编辑 **直接落盘**；仅 **删除/归档** 进入待确认 |

用户话术：

- **自动保存** → `auto`  
- **删除/归档前问我** → `confirm`（分级：编辑直接落，删/归档才问）

**主动建议 ≠ 自动写**：系统可默认生成建议卡片；执行高影响写入仍须确认 + protection。  

**locked 语义（2026-09-17c）**：`auto` 下 AI **可以**写 locked —— 本任务对该文件的**首次**覆盖做一次快照+YAML 回执，同任务后续编辑原地更新。**删除/归档 locked 也可在 auto 进行**（走 trash/归档目的地，可恢复+回执）；**永久删除** locked/core 仍须用户。`confirm` 为分级：内容编辑直接落盘；删/归档待确认。用户写 locked 始终可以（同样任务级快照）。

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

**回执定义（防冗余）**：

| 层 | 何时有 | 载体 |
|----|--------|------|
| **工具证据**（evidence） | 每次写 | 返回值：targetPath · wroteFiles · backupPath? · receiptPath? |
| **YAML 回执**（receipt） | 仅高影响恢复轨迹 | `99-归档/receipts/*.yaml`（locked 首写快照 · 可恢复 delete/archive） |
| **ops journal** | 每次工具/维护 | Desktop `logs/ops.jsonl`（审计，不是第二套 receipts） |

**`receiptPath` 仅在存在真实 YAML 回执时非空**——不回退为 `backupPath` 别名。撤销/恢复请看 `backupPath`（或 trash 路径）。

## 可逆性（高影响 only）

- 锁定 / 核心笔记 **delete** → 移入现场 system 目录的 `backups/trash` + 回执（**AI auto 允许**）；普通开放笔记删除无 trash；`permanent` 则无副本，**AI 不可对 locked/core 永久删**  
- **archive** → 迁入现场 system 目录当**新家**（非备份）；YAML 回执仅锁定/核心；AI auto 可归档 locked（可恢复）  
- **locked** 既有文件覆盖 → **任务内一次**旋转快照 + 回执（多步编辑不重复备份）  
- 常规 **open** 更新 → 不造备份/回执（不伪造路径）；证据仍含 target path + affected files  
- AI + locked：`auto` 允许内容编辑（任务级快照）与可恢复删/归档；`confirm` 待确认；永久删仅用户

## 错误处理（共享）

写入失败时不得静默丢弃数据。按以下优先级处理：

| 错误类型 | 处理 |
|---------|------|
| 磁盘满 / 权限不足 | 报错 + 已备回复制位置；不静默丢数据 |
| 路径过长 / 非法字符 | 提示用户缩短专题名或使用合法字符 |
| 工作区外路径 | 拒绝（围栏不可授权绕过） |
| 工作区无 `topmind.yaml` | 按默认契约解释 + 回执标注「默认契约」 |
| UTR 不可用 | 降级为 Host 文件工具（见 `capability-degradation.md`） |
| 网络抓取失败 | 保留 URL + 摘录；不假装已成功 capture |
| AI 分析失败 | 诚实报错不写；不生成占位符假装成功 |
| 源文件不存在（promote） | 报错 + 路径；不静默跳过 |
| 参数缺失 / 值非法 | 明确报错指出缺失字段或非法值；不猜测默认 |
| 周期本解析失败 | 回退为新建文件 + 回执标注「新建周期本」 |
