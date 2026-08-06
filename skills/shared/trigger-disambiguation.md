# Trigger Disambiguation（路由消歧真源）

> Router（`topmind`）与各子 skill 的「When NOT」必须与本表一致。  
> 子 skill **不得**自动链式 dispatch 下一 skill；「下一步」仅用户面建议。

## 碰撞词裁决

| 用户说 | 撞到的 skills | 裁决 |
|--------|--------------|------|
| 总结要点 | organize vs memory | 默认 → `topmind-organize`。仅「写进 topic.md / 加到专题记忆 / 沉淀结论」→ memory |
| 沉淀 | capture vs memory | 默认 → `topmind-capture`。仅「沉淀成稳定结论 / 写进 topic.md」→ memory |
| 体检 / 检查 | maintain vs loop | 「快速体检 / 体检 / 检查 / doctor」→ maintain。「整体体检 / 全面检查 / 巡检 / audit / review」→ loop |
| 审计 / audit | maintain vs loop | 默认 → loop。maintain 用 doctor / 诊断 / 快速体检 |
| 整理 | organize | 「整理 inbox」→ organize + `plan-inbox-routing`。其它 → organize |
| 复盘 | organize vs loop | 「复盘」→ loop。「复盘要点成笔记」→ organize |
| 归档 | capture vs maintain | 「归档材料」→ capture。「归档专题 / archive topic」→ maintain |
| 笔记 / note | capture vs write | 未限定 → capture。「写作 / 起草 / 续写」→ write |

**原则**：动作动词定 action；修饰词定 confidence。无法判定 → capture（先存后整）。

## 写回边界（与复利纪律对齐）

| 动作 | 默认写什么 | 禁止 |
|------|------------|------|
| capture | 材料笔记 | 改 `topic.md`；自动 organize/memory |
| organize | 专题根综合/结构笔记（留痕） | 自动写稳定记忆；建 `INDEX.md` / entities 树 |
| memory | 仅 confirmed stable → `topic.md` | 因 capture/整理顺手刷写 |
| write | 稿件 / delivery | 为「补结构」空建 `topic.md` |
| loop | 状态 / 可逆修复 | 代写记忆；建硬索引 |

## 多意图顺序

| 意图组合 | 裁决 |
|---------|------|
| capture + organize | 先 capture，回执建议 organize（不自动链式） |
| capture + memory | 先 capture，回执建议 memory（须用户再确认才写 topic.md） |
| organize + write | 先 organize（落盘综合），再 write |
| organize + memory | 先 organize 候选与综合笔记，**用户接受建议后再** memory |
| write + memory | 先 write，回执建议 memory |
| 整理 inbox | organize + plan-inbox-routing（不是 maintain/loop） |
| 清理工作区 | maintain |

三个以上意图：拆成顺序步骤，每步回执。

## Action unsure

- 内容动词（写/存/记）且无修复/巡检 → capture  
- 修复 / 清理 / 重建 → maintain  
- 巡检 / 整体 / 断点 → loop  
- 整理 / 分析 / 总结 → organize  
- 写 / 发布 / 出稿 → write  
- 记忆 / 沉淀结论 / topic.md → memory  
- 仅类别名 → capture 到该类别根  
- 全不像 → capture 到 Inbox（buffer）  
