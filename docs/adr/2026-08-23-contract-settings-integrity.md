# ADR: 契约完整性收口与设置持久化审计——修复语义与两宿主边界确认

> **状态**：Accepted · **日期**：2026-08-23（第五轮修订 2026-08-24：D11 双向粘滞、D12/D13、D14 宿主打开路径）
> **取代**：无（收口 2026-08-13 对抗式评审的契约生命周期遗留缺口）
> **影响范围**：lib/contract-engine.mjs · lib/model-core.mjs · lib/model-stream.mjs · lib/memory-engine.mjs · lib/suggest-engine.mjs · lib/ai-operation-engine.mjs · lib/todo-engine.mjs · lib/writeback-engine.mjs · topmind-desktop（settings / system-service / OverlayHost）· obsidian-plugin（settings / main）· tests

## 背景

对设置体系与工作区契约做了一次全链路审计（Desktop `app-settings.json`、Obsidian `data.json`、共享 `topmind.yaml` 契约、`.topmind/` 状态文件），覆盖：设置项正确性/完备性/一致性、UIUX 持久化、配置损坏检测/自动修复/版本升级、以及「底层配置在 Desktop 与 Obsidian 是共享还是独立」的边界核实。审计发现并修复了以下**已复现**缺陷（均有回归测试钉死）。

## 决策

### D1: 契约修复必须收敛（repair 必须到达 ok）

- **null section 死循环**：`memory: null`（YAML 空节）曾使 `ensureContract` 每次都报 repairable 并重写，但写出的仍是 `memory: null`，永不收敛。修复：`deepMergeContract` 对显式 null 叶子保留 defaults（与顶层 null 行为一致）；`sanitizeContract` 跳过 null section 并防御性重建所有 section 为对象。
- **版本号双标准**：`validateContract` 曾用严格 `!==`、`inspectContract` 用 `Number()`——字符串 `"4"` 产生自相矛盾的错误消息（"expected 4" 却显示 4）。统一为 `Number()` 比较；**缺失** `contract_version` 现在报 repairable（repair 时盖上 4），不再永久无版本号。
- **repair 不覆盖用户模板**：repairable 路径曾让 `opts.templateId` 无条件覆盖盘上模板（Obsidian 每次启动硬编码 `initWorkspace("stream")`，用户 `balanced` 会被洗掉）。修复：repair 只在盘上值缺失时才应用 `templateId/locale/name`；create/legacy 迁移路径不变（首次初始化的模板选择仍有效）。

### D2: 覆盖坏文件必须先备份——无例外

- **corrupt + legacy 迁移曾无备份覆盖**：垃圾 topmind.yaml + 合法 `.topmind-config.json` 会直接迁移覆盖，坏文件丢失。修复：该分支现在先 `backupContractFile` 再写。
- **reseed 备份同秒冲突**：备份名时间戳只到秒，同秒两次 reseed 互相覆盖。修复：毫秒时间戳 + 随机后缀。
- **reseed 语义与文档对齐**：`reseedContract` 对 ok/repairable 契约曾是无操作（UI 却报「已重建 ✓」）。修复：reseed 对任何状态强制「备份 + 写全新默认」——用户触发的恢复动作必须诚实。

### D3: writeContract 原子写（tmp + rename）

`topmind.yaml` 曾是唯一没有原子写的状态文件（直接 `writeFileSync`，崩溃中途产生截断 YAML → corrupt → unrepairable）。现改为 tmp(pid+时间戳)+rename，与 `.topmind/ai-ops.json`、`suggest-fingerprints.json` 的既有模式一致。

### D4: 重建式保存保留未管理键

两处「从固定键清单重建 section」的保存路径曾静默丢弃未管理键：

- `saveWorkspaceConfig`（model-core，addCategory/renameCategory 等走此路径）：workspace/stream/memory/writeback 现与盘上对应 section 深合并（重建值胜出；`stream.default_view`、`memory.files`、自定义 workspace 键存活）。**categories 整体替换**——override 删除不能复活。
- Desktop `updateWorkspaceConfig`（system-service）：stream/memory 现在在原 section 上覆盖受管键，`year_dir: false`、`default_view` 不再被重置为默认；`memory.files` 显式数组（含空）即设置、缺省保持盘上值。

### D5: Kernel env 覆盖改为调用时读取

`writeback-engine` 的 `BACKUP_KEEP`/`RECEIPT_KEEP` 曾在模块顶层读 env——Obsidian 的 Kernel 是静态打包（bundle 加载即求值），`onload` 里设置的 env 永远到不了引擎，滑杆形同虚设。现改为**每次剪枝时读取**，两宿主一致生效。

### D6: Desktop 设置写方一律 partial patch

审计发现多个「全量展开 + 单字段覆盖」的写方，会把陈旧快照写回并回放到 live shell：

- ManagePanel 曾发 `{ ui: {...settings.ui, autoCheckUpdates} }`（可能回写旧侧栏宽度/AI 面板开合）；action-store 曾发全量 `ai`（可覆盖 `fetchLiveModels` 刚写的 modelCache）。均改为 partial patch。
- 新增 `AppSettingsPatch` 类型（顶层可选 + 嵌套 section partial），从类型上引导「只发改的键」。
- Obsidian 同理：`migrateSettings` 保留 `ai.*` 下未知键（未来 schema 增量不丢）；首次运行 `structuredClone(DEFAULT_SETTINGS)`（浅拷贝曾污染模块常量）。

### D7: writebackMode 显示缓存三方对齐为 `auto`

Obsidian data.json 默认曾是 `"confirm"`，与契约默认 `"auto"`、Desktop 默认 `"auto"` 不一致——未初始化工作区的设置面板会显示 confirm 而 Kernel 实际按 auto 运行。统一为 `auto`；且 Settings 打开时若 hydrate 改变了显示缓存值，立即落盘（data.json 不再长期陈旧）。操作真源不变：始终是 `topmind.yaml` `writeback.mode`。

### D8: 绕过 SettingsDialog 的直写路径必须同步渲染端缓存（第二轮）

TitleBar 主题切换、Sidebar 文件过滤、编辑器 Aa 面板（editor-prefs）曾直接 `api.sys.update` 而不更新 `settings-cache`——SettingsDialog 首帧用旧缓存绘制，显示值回跳。现三处统一经 `patchCachedSettings` 合并后再落盘。

配套 UIUX 一致性修复：

- **SettingsDialog 关闭先冲刷**：`onClose` 曾 fire-and-forget 挂起批次后立即卸载，紧接退出可能丢最后一次编辑；现 await `flushPending` 后再关。
- **数字输入空值不落盘**：字号/行高/Clip 端口清空输入框瞬间 `Number("") === 0` 会闪 clamp 并持久化；空串直接跳过，待有效值再提交。
- **重置布局只重置布局**：「重置布局」曾连带重置 fileFilter/closeBehavior/sidebarView；现仅重置侧栏宽度/折叠/AI 面板开合/宽度四个几何键。
- GeneralPanel 全部 editor 补丁转为 partial（与 D6 策略一致）。

### D9: Obsidian 加载健壮性与备份副作用（第二轮）

- `migrateSettings` 增加逐字段类型归一化（枚举校验 + backupKeep/receiptKeep clamp + 布尔兜底），损坏的 data.json 不再把垃圾值渗透进 UI 与 Kernel env 桥——对齐 Desktop settings-core 的 normalize 纪律。
- `mergeAiBackup` 的 legacy 恢复分支曾是死代码（`aiBaseUrl`/`aiModel` 默认值非空导致 `!value` 永假）；改为「当前值等于默认哨兵且备份携带非默认值才恢复」。
- `saveAiKeysBackup` 不再往非 topmind 工作区的 vault 创建 `.topmind/`（仅在目录已存在或工作区已初始化时写备份）。

### D10: 诚实性收口（第二轮）

- Desktop `autoRepairWorkspace` 在契约 corrupt/unreadable 时**跳过目录改名**：分隔符不可知时按 FS 推断批量 rename 是在猜；交给 unrepairable→reseed 恢复路径，修好契约后再跑。
- UTR doctor 的 `mapWorkspaceIssueCode` 不再把 `contract-*` 代码扭曲成 `workspace-contract-*`（契约代码已有命名空间）。
- contract-engine protection 合并注释失实（声称 system:locked 基线，实际用户显式覆盖可赢）——改为如实描述「defaults 合并，非不变式」。

### D11: 旧工作区自动升级——周期路径粘滞（第三轮）

2026-08-09 D1 引入 `year_dir: true` 默认后存在一个被低估的组合缺口：pre-D1 旧工作区的契约**从未持久化过** `year_dir`，升级后缺省翻 true，而**写入侧五个入口**（UTR 捕获 / Desktop ingest / Obsidian 捕获 / todo 同步 / ingest 路由）全部只认年目录路径——当前周期的既有平铺文件被遗忘，同周期内容分裂两文件，且显示侧回退让「捕获消失」。读取侧双模式扫描早已兼容，缺的正是写入侧。

- **周期路径粘滞（核心，双向）**：`resolveStreamTarget` 的粘滞覆盖两个方向——年目录模式下，若当前周期的**平铺文件已存在且年目录孪生不存在**，定位平铺文件（每个周期待在它出生的地方，新周期才进年目录；孪生已存在时年目录胜出，目标永不回跳）；用户把 `year_dir` 切回 false 后，生于 `{年}/` 的当前周期**继续在年目录文件追加**（UI 文案承诺「已有周期本继续在原位置追加」，切关场景同样成立），仅新周期走平铺。一次修复覆盖全部写入入口。
- **periodic 反思同理**：`resolvePeriodMemoryPath` 对既有平铺反思文件粘滞，digest 更新写回原文件而非另生年目录孪生。
- **`archiveStreamYear` 兼容平铺年份**：旧工作区 `{年}-W30.md` 平铺文件可与年目录一起（或单独）归档进 `99-归档/stream-archive/{year}/`。
- **legacy v3 迁移一次性化**：迁移成功后 `.topmind-config.json` 改名为 `.migrated`（内容保留、绝不删除）——防止日后手删 topmind.yaml 时从**过期 v3 快照**再次迁移、覆盖此后所有配置变更。
- **Obsidian 反思读取双扫描**：`loadRecentReflections` 同时扫平铺与 `{YYYY}/`（原实现二选一，年份目录存在但为空时平铺文件被整体忽略）。
- **Desktop 暴露 year_dir 开关**：工作区设置新增「按年归组周期本」（`system.updateWorkspaceConfig` 接受 `stream.yearDir`，写契约 `year_dir`），兑现 2026-08-09 ADR 的承诺。
- 配套：`listStreamPeriods` 排序加 relPath 平手裁决（平铺/年目录孪生顺序确定）；`useShellSettingsSync` 以「快照对比」取代一次性 skip 标志（消除启动冗余回写与标志竞态）。

回归测试：`tests/period-path-stickiness.test.mjs`（7 用例）+ contract-lifecycle 的 legacy_retired 断言。

### D12: Memory 平面契约感知——消除第二套硬编码路径（第四轮）

审计发现 Kernel 内存在**两套 memory 路径解析**：`model-memory.resolveMemoryPaths`（Desktop 路径操作/AI 上下文用）遵守契约 `memory.dir` + `memory.layers.global.file`，而 `memory-engine` 全部硬编码 `memory/profile.md`——**legacy v3 迁移自己就会产出自定义 `profileFile`**（`migrateV3ToV4` 显式保留），这类工作区会出现「Desktop 按契约读写 `{dir}/me.md`，AI 记忆操作读写 `memory/profile.md`」的双胞胎画像，且 `ensureMemoryPlane` 会另生一个 `memory/` 平行目录。修复：

- **memory-engine 契约感知**：`resolveMemoryDir` / `resolveMemoryLayerPath("global")` 经 `loadContract + normalizeMemoryConfig` 解析（缺省/损坏契约回落默认 `memory/profile.md`）；`ensureMemoryPlane`、todo-history、`loadRecentReflections` 随之统一。
- **payload digestPath 与写入侧同源**：`periodMemoryRelPath(period, { workspaceRoot })` 走 `resolvePeriodMemoryPath`（契约目录 + 平铺粘滞）——建议条里的 `digestPath` 不再指向不存在的年目录孪生；suggest-engine / ai-operation-engine 全部调用点传 workspaceRoot。
- **suggest / ai-operation 的 profile 硬编码清除**：open-profile 建议、promote/retire 建议 targetPath、`applySuggestion open_profile` 创建路径全部经统一解析；创建模板统一为 `globalProfileSeedMarkdown(locale)`（原内联模板缺 `source_type`，会产出结构分叉的双胞胎）。
- 无 workspaceRoot 的 `periodMemoryRelPath(period)` 保持纯字符串构造（默认目录 + 年目录形），向后兼容。

回归测试：`tests/memory-contract-paths.test.mjs`（6 用例：自定义 dir/file 解析、ensureMemoryPlane 不建 memory/ 孪生、append 写契约路径、periodic 粘滞、open-profile 建议目标、默认工作区不变）。

### D13: 设置对话框关闭路径与失败语义收口（第四轮）

- **Esc / 遮罩 / 快捷导航绕过冲刷**：只有 X 按钮走 `await flushPending()` 的路径，Esc 与遮罩点击直接 `closeOverlay()` 卸载对话框——防抖窗口内的编辑丢失运行时副作用（插件启停、缓存同步）。新增 `lib/overlay-close-guard.ts`：SettingsDialog 挂载时注册守卫，OverlayHost 的 Esc / 遮罩 / navigate / sidebar-view 关闭路径统一 `requestCloseOverlay()`（先冲刷后关闭）；卸载冲刷保留为兜底并与在框冲刷应用同一套响应副作用。
- **冲刷失败不丢批**：`flushPending` 失败原先只 setError——批次已被清空、乐观缓存保持未保存值（重开对话框显示「已保存」假象）。现在失败时批次**重排队**（下次冲刷重试），编辑保持「待保存」语义。
- **rotateToken 只发 clipBridge 补丁**：原先发全量 settings——全量 `ui` 会经 live-apply 把磁盘快照布局回放到 live shell（500ms 窗口内拖过的侧栏/AI 面板宽度被静默丢弃）。
- **fileFilter 设置即时生效**：Settings 改文件类型过滤原先不触发 `sidebar:file-filter-changed`，侧栏/输出视图要重启才刷新。
- **packing 切换不再硬编码 `appendHeading: "day"`**：只发 `{ packing }`，后端保留盘上 `append_heading`（`none` 不被静默重置）。
- **防御性收口**：`NESTED_KEYS` 补 `capture` / `ingest`（缺键会让 partial patch 静默整段替换）；`patchCachedSettings` 补 `clipBridge` 深合并；控制器加载竞态守卫（IPC 往返期间已产生的编辑不被磁盘快照视觉回退）。

回归测试：`topmind-desktop/tests/settings-close-paths.test.mjs`（守卫注册、关闭路径全走守卫、失败重排队、rotateToken partial、fileFilter 事件、packing 纯键、空画像文件名回落 `profile.md`）。

### D14: 宿主打开路径与 skip 回执跟契约走（第五轮）

D12 收了引擎写入面，但 skip 回执、待办文件、两宿主打开入口仍硬编码 `memory/profile.md` / `memory/todo.md`，设置读取还漏了 v4 `layers.global.file`：

- **skip `targetPath`**：`appendProfileEntry` / `retireProfileEntry` / `updateProfileEntry` / `appendTopicEntry` 的 skip 回执走 `globalProfileRelPath`（及契约 dir 下的 topics），不再对自定义 dir 撒谎。
- **todo 文件**：`resolveTodoRelPath` / `resolveTodoPath` 经 `memory.dir`；archive/snapshot 已走 `resolveMemoryDir`。默认常量 `TODO_REL_PATH` 仅表示 canonical 缺省。
- **活动窗口 / 可恢复删除**：`classifyActivityPath` 与 `isRecoverableLifecycle` 识别自定义 memory dir，避免把 `70-记忆/me.md` 当普通笔记。
- **Desktop 设置投影**：`getWorkspaceConfig` 经 `normalizeMemoryConfig` / `normalizeStreamConfig` 投影 v4 嵌套键（`layers.global.file`、`year_dir`→`yearDir`）；空画像文件名回落 `profile.md`。返回盘上 raw `stream` 会让 `year_dir: false` 在 UI 上画成开（`yearDir !== false`）。
- **Obsidian 打开入口**：`profileRelPath` / `todoRelPath` / `memoryDirAbs` 经 Kernel；命令、动态页、侧栏待办、聊天画像与反思扫描全部跟契约；`mapApplySuggestionResult` 不再在缺 `targetPath` 时发明 `memory/profile.md`。

回归：`tests/memory-contract-paths.test.mjs`（skip 回执、todo 路径、自定义 dir 可恢复性）+ `workspace-contract-desktop-path` 的 getWorkspaceConfig + Obsidian `plugin.test` / `kernel-integration`。

## 两宿主边界（审计确认，无行为变更）

| 层 | 真源 | 共享/独立 |
|---|---|---|
| 工作区行为契约 | `topmind.yaml` v4（Kernel 单写入器） | **共享**（`writeback.mode`、locale、模板、类别） |
| Desktop UI 偏好 | `app-settings.json`（原子写 + `.bak` + 逐字段 normalize） | 独立 |
| Obsidian UI 偏好 | 插件 `data.json`（经 `migrateSettings` 合并默认） | 独立 |
| AI 密钥 | Desktop secureStorage/明文 + Obsidian data.json + `.topmind/ai-keys-backup.json` 双写 | 结构共享（`ai.manual` 形状一致），存储独立；Desktop「Export for Obsidian」单向导出 |
| AI 输出语言解析 | `lib/ai-output-locale.mjs` 单实现 | **共享**（tier-2 各自喂宿主 UI 语言：Desktop `ui.locale`、Obsidian `localeOverride`） |

`writebackMode` 在两侧 data 文件里均为**显示缓存**（启动从契约 hydrate、改动镜像回契约），有回归测试守卫不 fork。

## 已知不修（有意保留）

- Desktop settings normalize 对未知嵌套键的丢弃：closed-schema 设计（顶层白名单 + 字段级 normalize + defaults 合并即迁移），不做版本号框架；破坏性重命名时再引入。
- `clipBridge.token` 明文落盘：loopback 鉴权，威胁模型内可接受。
- 未知**顶层**契约键在 repair 时剥离（有 warning）：schema 白名单语义，自定义数据请放 section 内。
- 跨进程 settings 写竞争（同文件两进程）：单实例 guard + 原子 rename 保证不损坏，last-writer-wins 可接受。
- safeStorage 解密失败（换机/keychain 重置）：UI 显示为未配置、磁盘残留旧密文但无害；用户重输密钥即覆盖。不做自动清密文（避免误删可恢复的密文）。

## 后果

- 契约 repair 保证收敛到 `ok`；任何覆盖坏文件的路径都有备份。
- 设置面板不再有陈旧全量回写路径；两宿主显示缓存默认一致；所有关闭路径先冲刷；冲刷失败重排队不丢批。
- Memory 平面只有一套路径真相：所有引擎读写都经契约解析（自定义 `memory.dir` / `profileFile` 工作区无双胞胎）。
- 测试：root 契约/粘滞/记忆路径用例 + Desktop 设置关闭/工作区配置投影 + Obsidian 打开路径守卫。质量门以 `npm run validate` / `desktop:quality` 为准。
