# Topmind Skills 模型评测

24 个合成场景分别对应核心与写作仓的 12 个既有用例。`source` 连接原用例，`request` 和 `context` 是本评测输入。模型看不到期望技能、评分条件和其他本地工作区内容。公开 Skill 正文在模型选中后加载。

| 对照组 | 模型获得的内容 |
| --- | --- |
| `no-skill` | 合成任务和统一的输出协议 |
| `release` | 同一任务、公开技能目录、所选技能的正文 |
| `candidate` | 公开版加一段候选路由指引，执行阶段使用相同 Skill 正文 |

评分同时记录主技能是否命中、产物是否符合可判定条件、是否提出额外操作。`actions` 是模型返回的操作意图，评测程序不会执行。HTML 只做静态检查。生产写入、确认续跑、真实图片、平台粘贴和发布需要在产品宿主单独验收。

## 运行

```sh
node scripts/skill-benchmark.mjs --check
node --test tests/skill-benchmark.test.mjs

public_dir=$(mktemp -d /tmp/topmind-public-eval.XXXXXX)
curl -q -fSs https://registry.npmjs.org/@topmindspace/topmind-skills/-/topmind-skills-4.15.10.tgz -o "$public_dir/topmind-skills.tgz"
curl -q -fSs https://registry.npmjs.org/@topmindspace/topmind-writing-skills/-/topmind-writing-skills-0.9.3.tgz -o "$public_dir/topmind-writing-skills.tgz"
node scripts/skill-benchmark.mjs --check --public-dir "$public_dir"

node scripts/skill-benchmark.mjs --host codex --model gpt-6.1-sol \
  --condition release --public-dir "$public_dir" --output "$public_dir/codex-release.json"
```

可用 `--group core|writing` 或多次 `--case <id>` 选子集。用 `--host claude --model sonnet` 可以跑第二个入口，报告同时记录请求的名称和 CLI 返回的实际模型。若账号经过网关，以响应记录为准。发布包 SHA-512 由脚本核对。只在 `--check` 时读取两套本地用例文件，运行模型时技能正文来自固定的公开包。`no-skill` 无需提供 `--public-dir`。

## 读结果

- `passed` 表示该场景的自动检查全部通过。`routePassed` 单独记录路由命中，空值表示该组没有技能目录。
- 原文保真和行数检查取单一可复制代码块内的内容。块外说明另行人工核对。评分规则调整后，用 `--rescore 原始报告.json --output 复算报告.json` 复算，输入场景的摘要必须一致。报告分别保存模型输入和评分语料的摘要。
- `unexpectedActions` 记录额外操作，包括路径正确但重复执行。同一任务还需要对照实际文件与用户意图做人工验收。
- 报告记录场景、Skill 正文摘要、每批耗时和 CLI 返回的用量。批内任务共享一次模型调用，耗时是批次耗时。网关报告的成本仅用作日志。模型输出和用量报告保存在指定输出文件。
- 每个场景跑一轮时，结果适合定位问题。要据此改变默认路由，先用独立同义场景复测，覆盖不同模型与实际宿主，并人工复核保真和返工量。

## 宿主实机复验

CLI 评测记录模型产物，宿主复验检查文件实际变化。两条实机脚本分别启动临时 Desktop 状态和临时 Vault，用回环模拟模型重放相同场景。

```sh
# 在 topmind 仓
npm run --prefix topmind-desktop build
node evals/smoke-desktop.cjs --playwright "$playwright_root"

# 在 topmind-obsidian 仓
npm run typecheck && npm run build
node scripts/smoke-obsidian.cjs --obsidian "$obsidian_executable" --playwright "$playwright_root"
```

`playwright_root` 指能解析 Playwright 的目录。`obsidian_executable` 指 Obsidian 可执行文件的绝对路径。脚本输出临时目录，包含截图、生成文件和验证结果。验证长文只改尾句、缺图时 HTML 与预览一致、清单失败的部分回执、只读边界，以及确认后的安全续跑。

交付回归还会在预览后补上缺图，确认旧预览和导出按钮失效，已经保存的 HTML 保持原样。重新生成后检查 HTML 实际嵌入图片和缺图提示消失。

Desktop 回放还检查 Pi 输出触顶后返回部分正文、明确错误和服务商用量，以及技能设置从只选一项到全停用、再恢复全部时，与聊天快捷入口一致。Obsidian 回放在更改格式和主题后检查当前键盘焦点。
