# Multi-Intent Resolution

当用户请求包含多个意图时，按以下矩阵裁决（与 `shared/trigger-disambiguation.md` 一致）：

| 意图组合 | 裁决 | 说明 |
|---------|------|------|
| capture + organize | 先 capture，回执中建议 organize | 先确保材料落地 |
| capture + memory | 先 capture，回执中建议 memory | 先存笔记再更新我的情况 / 周期反思 |
| organize + write | 先 organize 提炼，再 write 输出 | 分两步 |
| organize + memory | 先 organize 候选，再 memory 落盘 | organize 产出列表 |
| write + memory | 先 write，回执中建议 memory | 写作不改 memory/profile |
| 整理 inbox | `topmind-organize` + `plan-inbox-routing` | 不是 maintain/loop |
| 清理工作区 | `topmind-maintain` | 系统健康 |

**三个以上意图**：分解为顺序步骤，逐步执行，每步返回回执。

子 skill 回执里的「下一步」**不构成**自动链式触发。  
