# Changelog

All notable changes to PhysioFlow are documented in this file.

## [0.6.0-beta.3] — 2026-09-04

### Added

- Graph セッション開始前のローカルメディア参照・存在・チェックサム検査。復元実行にも同じゲートを適用。
- 必須デバイスの接続プリフライト、Inspector の任意接続切替、実行中のサンプリング障害表示。
- 復旧スナップショット保存失敗の警告と再試行操作。

### Changed

- 復旧スナップショットを直列保存し、完了セッションの確定前に保留中の書き込みを待機。
- Tauri のテキスト／バイナリ保存を、一時ファイルを同期してから置換する方式へ変更。
- Custom HTML の sandbox を旧ランタイムと V2 で統一し、スクリプト実行を無効化（HTML/CSS は継続対応）。

### Fixed

- ローカルメディア欠損時に空白刺激のままセッションが進行し得る問題。
- IndexedDB／ローカル保存の失敗が成功扱いになり、復旧可能に見える問題。
- 必須デバイスの接続・adapter 解決に失敗しても実験が開始される問題。
- 公開参加者 E2E がページ遷移中の一時的な空 document で不安定になる問題。

---

## [0.6.0-beta.2] — 2026-09-04

### Changed

- 刺激随机分配改为按「已完成的呈现次数」推进：操作员 Retry 会重新呈现同一个刺激（不推进），循环再次进入节点时才抽下一张；单节点循环按整池顺序不重复抽取，耗尽后按同一顺序循环。`stimulus_assigned` 的 `attempt` 现在表示该节点「第几次呈现」（presentation ordinal）；原始进入/重试次数仍记录在 `component_entered` / `component_retried` / `component_completed` 事件中。
- Participant UI 编辑器拖动改为「直接拖 + 自动整齐转自由」：在流式模板里拖动元素会自动把该容器转为自由布局，被拖元素停在原位跟手，其余元素按 8px 网格整齐排列在下方，不再闪到 `(0,0)` 或乱散。
- 对齐参考线/吸附/缩放手柄与元素库拖入的坐标换算统一为容器本地坐标（修正非 100% 缩放下的错位）；新增 **Auto arrange** 一键把自由布局重排整齐；多选对齐/分布仅作用于同一容器。
- 节点 Inspector 整理：字段组默认展开第一组；刺激池选择与 Records 只在非 Quick 模式显示；`questionnaire`/`wait` 节点全屏打开改为纯预览（其界面由运行时生成，编辑会被丢弃），并隐藏其「Edit participant screen」入口。

### Fixed

- 修复本地上传媒体与直接填写的 URL 在 Runtime V2 与 Composer V2 预览中显示 “Media source not configured”：渲染期解析现在接受应用自身生成的 `blob:` 对象 URL 与 `data:` URI，并在没有资源条目时回退到节点上直接填写的 `sourceUrl`；托管交付校验（`safeDeliveryUrl`）保持严格不变。
- 修复 `display.screen` 节点 Inspector 的「Screen content」字段修改后不生效的问题（现在与参与者界面的标题 Text 双向同步）。
- 修复 Participant UI 提交会清空已填写的媒体 URL/类型/范围等配置的问题（现在在 UI 元素未携带该值时保留节点原有配置）。
- 修复 Participant UI 单击（非拖动）元素会闪现跳到 `(0,0)`、以及缩放非 100% 时拖入/缩放尺寸错误的问题。

---

## [0.6.0-beta.1] — 2026-09-04

### Added

- 集中式 Stimulus Pool，可在不改变实验流程的情况下按 session 对媒体进行可复现、无放回随机分配。
- 实验开始前的随机刺激分配预览与重新生成顺序功能。
- 本地媒体上传，以及编辑器预览和 Runtime V2 中的本地资源加载。
- V2 问卷中的图形化 SAM 选择和实时参与者预览。

### Changed

- Participant UI 改为独立全屏编辑，媒体、评分、文本和 Custom HTML 配置与节点运行配置保持同步。
- Protocol JSON 编辑器增加行号、格式化、错误位置、未应用修改状态及关闭保护。
- 增强节点插入逻辑、编辑模式说明、日语验证信息和正式运行前配置校验。
- Windows Release 改为 current-user、多语言 NSIS 安装包，无需管理员权限。

### Fixed

- 修复 Stimulus Pool 媒体被 Readiness/Dashboard 误判为缺少媒体的问题。
- 修复本地上传资源只能保存、无法在 Composer V2 预览的问题。

---

## [0.5.4] — 2026-08-26

### Added

#### 画布渲染性能优化（W4）
- **节点卡片 memo 化**：节点渲染抽取为独立 `NodeCard` 组件，配合 `useCallback` 稳定回调与 live refs，仅在节点/边/选择/端口等引用变化时重渲染，拖拽闭包始终持有最新值。
- **O(1) 派生索引**：`nodeById` / `stepsById` / `filteredIds` 改用 `useMemo` + Map/Set 构建，替代 `Array.find()` 线性查找，消除每次渲染重建。
- **性能门禁扩充**：`performance-gates.test.js` 新增「500 节点拖拽 60 帧」「500 节点标签编辑 20 次」两个交互预算用例（当前实测 119ms / 42ms，门禁 500ms / 200ms）。

#### 体验补齐（W5）
- **编辑器 undo/redo 作用域隔离**：`useUndoRedo` 新增 `beginScope()`/`endScope()`，进入 Builder/Setup/Runner 视为编辑器会话，离开时截断历史栈，切出编辑器后全局撤销不残留编辑器操作。
- **全视图 i18n**：Dashboard、SessionManager、Analytics、Onboarding、Guide 外壳与两个 Runtime Runner 页面的文案收敛到 `i18n.jsx` 字典（zh/ja 补齐，DOM 遍历式自动翻译，缺译回退英文）。
- **运行中变量检查器**：Runtime V2 运行面板新增 `⌄ Inspect` 实时面板，展示变量表（Name/Type/Value）、输出表（Port/Value）与 Flow state（Status/Current node/Completed/Skipped/Attempts/Loop counts）。
- **编辑器过渡动画与响应式布局**：面板展开、节点释放吸附加入过渡动画；运行界面与编辑器适配 560px 以下窄屏，新增 1680px 以上超宽布局。

---

## [0.5.3] — 2026-08-26

### Added

#### Composer V2 连线与键盘交互增强
- **拖拽连线（drag-to-connect）**：从数据输出端口按住拖到兼容输入端口释放即建立连线，临时线随拖动实时绘制；Esc 可取消进行中的拖拽，随后松开鼠标不会误连接；点选式连线（先点输出端口再点输入端口）保留，两种方式共用同一 `connect` 校验。
- **Ctrl+A 全选**：一键选中画布全部节点（自动排除入口节点），Shift/点击可继续调整选择。
- **缩放快捷键**：`Ctrl+=` / `Ctrl+-` 步进缩放（×1.25 / ×0.8，0.4×–2.5× 限幅）、`Ctrl+0` 复位视图（缩放 100% + 平移归零）。
- **Esc 分层取消语义**：编辑区内按 Esc 按优先级取消进行中操作——拖拽连线 → 点选连线 → 框选（marquee）→ 删除确认弹窗 → 最后清空全部选择与对齐参考线；`App.jsx` 全局层不再拦截 Escape，Esc 在 Builder 内永不触发退出。

### Tests
- 新增 `.playwright-cli/verify-interactions.cjs` 浏览器级验收：打开 Builder 后依次验证拖拽连线（2→3 条边、临时线无残留）、Ctrl+A 全选（4 节点选中 3）、Ctrl+=/Ctrl+0 缩放（100%→125%→100%）、点选连线中按 Esc 取消、Ctrl+A 后按 Esc 清空选择且不退出 Builder，8 项断言全部通过、无控制台错误。

---

## [0.5.2] — 2026-08-26

### Added

#### `input.response` 按键响应节点（旧版核心 step 补齐）
- **按键响应采集**：显示刺激文本并收集键盘响应（或点击选项按钮），实时记录 `value`、`response_key`、`reaction_time_ms`、`correct`、`timed_out` 五个数据字段，全部进入导出列与数据端口 `value`。
- **评分与反馈**：`correctValue` 设置后逐次标记正确/错误；`feedbackMode` 支持 none / correct_incorrect / always 三种反馈（先展示反馈再自动前进）。
- **时序控制**：`timeoutMs` 可选超时（0 = 无限等待，超时后以 `timed_out=true` 提交）；`autoAdvance` 按键即前进；`required` 语义保留。
- **编辑体验**：选项以 `value=label,key=1` 行格式编辑，Inspector textarea 自动在数组与行文本间转换；默认参与者 UI 模板（文本 + 输入 + Submit）随组件注册，可在 UI 编辑器中继续定制。
- **运行时**：独立 `ResponseRunner` 真实监听 `keydown`（忽略重复键），RT 自组件进入计时，与既有专用 runner（attention-check 等）分发路径一致。
- **迁移**：旧版 V1 `response` step 映射到 `input.response`，保留 `response_variable`、`response_options`（value/key/label 完整数组）、`response_auto_advance`、`response_required`。

### Tests
- 新增 `tests/response-node.test.js`：注册契约、options 解析/序列化往返与容错、旧版迁移映射、运行时 submit 端到端流程。
- 组件验收清单 22 → 23，线性图/UI 校验/正式校验自动覆盖新组件。
- 新增浏览器语义验收 STEP `composer-response`（`.playwright-cli/verify-step.cjs`）：节点渲染与 5 数据字段徽标、默认 UI 预览、options 行格式编辑往返、Preview run → 运行中显示刺激与 3 个选项按钮、真实按键 `y` 自动前进至 SESSION COMPLETE 并落库 5 行数据字段，12 项断言全部通过。

---

## [0.5.1] — 2026-08-25

### Added

#### 体验问题修复（节点功能业务审查 P2 全部闭环）
- **media URL 校验与内联提示**：配置校验新增 `config.media_url_invalid`（`http(s)/data/blob` 与相对路径判定，含空格/伪协议拒绝）；Inspector 的 Source URL 输入框实时红框 + 错误提示，无效 URL 在编辑器内即被发现，不再只等运行时 `media_error`。
- **数据流可见性**：画布节点底部显示数据输出徽标（dataFields 数量，悬停列出列名）；数据端口悬停显示下游连接目标（"value → 某节点"），"节点输出是什么、接给谁"一目了然。
- **完成模式一致性**：`stimulus.fixation` 新增 `completion.mode` 选择器（manual/fixed，durationMs 仅 fixed 显示）；manual 模式由 `schemaForNode` 自动注入 Continue 按钮（运行时行为，存储 schema 无需携带），fixed 模式保持纯注视点；配置校验对 fixation manual 豁免按钮检查。
- **validation 展示改进**：错误/警告不再截断前 8 条——超出时显示 "Show all (N)" 展开按钮；`zh` 界面下错误消息本地化为中文（code → 中文模板 + 节点名），`en/ja` 保持原文。
- **condition/loop 变量选择器引用上游节点输出**：新增 "Node outputs (upstream)" 分组，列出控制流上游节点的数据输出端口（`kind: 'output'` 绑定，运行时 `resolveBinding` 原生支持）；`Expected` 字段类型随输出端口 dataType 联动（number/boolean 专用输入）。

#### 画布交互追平旧版（P3 闭环）
- **节点搜索补齐**：`Ctrl+F` 任意焦点下聚焦搜索框并全选；实时匹配计数（"N matches"）；Enter 选中首个结果并居中；输入框内 Escape 仅清空搜索。
- **自动布局对齐旧版**：跳过组内节点（保持 group 包围框完整），未连通节点按索引排布到后续列（此前保持原位不动）。
- **流快照升级为完整 graph 状态**：保存节点/边/组/入口的完整快照，Restore 整体还原（可撤销）；支持重命名已保存快照；旧格式（仅布局）快照兼容恢复。

### Fixed
- 验收脚本 `.playwright-cli/verify-step.cjs` 新增 `composer-p2` STEP：数据徽标、Node outputs 分组、Expected 类型跟随、无效 URL 校验与内联错误 5 项浏览器级验收全通过；新增 `composer-p3` STEP：Ctrl+F 搜索、匹配计数、Enter/Escape、自动布局、快照保存/恢复/重命名/整体还原 9 项浏览器级验收全通过。
- **画布输入框按 Escape 退出 Builder 的真实缺陷**：`App.jsx` 全局 Escape 在 builder 视图无条件返回列表页，导致在搜索框/快照命名框按 Escape 清空时直接退出画布。修复：输入框内 Escape 停止冒泡 + App 层对 INPUT/TEXTAREA/SELECT 聚焦态防御。
- **删除节点后返回列表页的真实缺陷**：`performDelete` 误用 `removeNode(...).protocol`（`removeNode` 返回 protocol 本身），导致 `commit(undefined)` 清空当前协议、App 渲染回首页。修复为直接使用返回值。
- lint 清零：`ResizeObserver` 改用 `globalThis`、未用 `catch (error)` 收敛、`ParticipantUiCanvas` 的 `useRef` 上移至 hooks 区。

---

## [0.5.0] — 2026-08-25

### Added

#### Composer V2 画布交互增强
- **对齐辅助线（Smart Guides）**：拖拽节点时实时计算与相邻节点左/中/右边缘、上/中/下中心的 6px 容差对齐，命中时显示参考线并**吸附到精确对齐位置**（优先于网格吸附）；多选整体拖拽按包围盒对齐；松手后参考线自动清除。
- **键盘导航**：方向键微调选中节点（24px/步，`Shift+方向键` 8px，并入撤销栈）；`Escape` 清除所有选择；`Enter` 打开单个选中节点的 UI 编辑器。
- **复制/粘贴携带内部连线**：复制所选子图时同时复制其内部连线，粘贴时按节点 id 映射重建（端口不兼容自动跳过）；连续粘贴位置递增偏移（40→64→88px），避免重叠。

#### 全界面响应式适配
- 所有界面（Dashboard、Composer V2、流程编辑器、参与者界面与运行器、问卷、启动页）针对不同分辨率与显示比例的自适应布局优化（弹性尺寸、最小宽度守卫、边栏折叠、间距收敛）。

### Fixed
- 迷你地图视口矩形改为实测画布尺寸（`ResizeObserver`），修复此前硬编码 `1800/zoom` 导致小窗比例失真。
- 拖拽吸附失效：`Object.fromEntries` 的 entry 对构建错误（map 返回对象而非 `[key, value]` 对）导致辅助线命中时节点不移动，已修复。
- `setPointerCapture` 在无真实指针环境（自动化/部分嵌入场景）抛异常，已加防御处理（真实浏览器行为不变）。

---

## [0.4.0] — 2026-07-13

### Added

#### Questionnaire overhaul
- **Drag-and-drop reordering**: Questions can be reordered via drag handle.
- **Conditional logic**: `show_if` field for skip/display logic (equals, not_equals, contains, greater_than, less_than).
- **11 question presets**: SAM valence/arousal, Likert 5/7, NPS, VAS slider, single/multiple choice, short/long text, number — one-click insert.
- **Auto-scoring**: `correct_answer` field with submit-time score calculation and export.
- **VAS slider type**: Visual analog scale (range slider 0-100) with min/max labels.
- **Random question order**: Questionnaire-level `shuffle_questions` + per-question option shuffle.
- **Progress bar**: Green progress indicator with answered/total count.
- **Batch CSV import**: Paste CSV (`type,en,options,min,max,answer`) to create multiple questions.

#### Full-screen node preview with inline editing
- **✎ Edit button**: Toggle between preview and edit mode. Edit name, content (zh/ja/en), response options, questionnaire, media source, duration, start mode, and analysis window flag — all in-place.
- **Preview accuracy**: Matches actual runtime rendering exactly (trial layout colors, padding, content width, eyebrow, step name heading).

#### Flow editor improvements
- **Undo/Redo**: Ctrl+Z / Ctrl+Shift+Z for node operations (drag, delete, connect, property changes). 40-step history.
- **Code splitting**: Analytics lazy-loaded (28KB separate chunk). Main bundle 552KB.
- **Canvas toolbar**: Fixed 34px single-row bar. Collapsible left palette and right inspector.
- **Flow snapshots**: Save/restore/rename/delete named flow states per trial.

#### Template configuration
- **Stroop task**: Configurable trial count, ITI jitter, practice block toggle.
- **Go/No-Go task**: Configurable trial count, go ratio (50-90%), ITI jitter, practice block toggle.

#### Simplified export
- **`bundleSimple()`**: 5 files (down from 10) with human-readable columns. `time_sec`, `step_path`, 8-column events.
- **BIDS v1.8.0 export**: `bidsBundle()` for neuroimaging pipelines.

#### Improved i18n coverage
- **300+ translation entries** for zh (中文) and ja (日本語) across all UI surfaces.

### Changed

#### UI/UX redesign
- **Flow editor nodes**: Compact 178px cards with left color accent, inline rule display, pill-shaped output ports, hover elevation.
- **Runtime participant interface**: Redesigned operator bar (48px), thinner fixation cross, smaller timer ring, larger response buttons, card-based questionnaire fieldsets, glass-morphism pause overlay.
- **Markers sidebar**: Collapsible, floating toggle button always visible.
- **Canvas bar**: Single-row fixed height, no wrapping.

#### CSS architecture
- Node/canvas-bar CSS consolidated into single source of truth. Removed 200+ lines of duplicates.
- Dark mode: Toast notifications, questionnaire form, audio player, scale inputs, choice lists all fixed.

### Fixed
- Node connection drag bug (React closure stale state + coordinate system mismatch).
- Canvas bar alignment, wheel zoom in fullscreen, markers z-index.
- ITI jitter validation tolerance for pre-v0.3.0 protocols.
- Pre-run checklist navigation accuracy and false positive reduction.
- Analytics initialSessions prop overwrite bug.
- Export-all skipped session count.
- Questionnaire designer sticky header prevents name field disappearing.
- Preview now uses actual trial layout colors.

---

## [0.3.0] — 2026-07-12

### Added

#### Experiment design
- **ITI jittering**: Trials support `iti_jitter_ms` and `iti_jitter_distribution` (fixed, uniform, normal, exponential). Jitter applied between trial repetitions at runtime.
- **Randomization constraints**: Blocks support `max_consecutive_same` and `no_immediate_repeat`. Active only when `order_rule` is `random`.
- **Practice blocks**: `is_practice` flag on blocks. Practice trials excluded from analysis windows.
- **Attention check step**: New `attention_check` type for catch trials. Configurable prompt (i18n), expected key, timeout, pass/fail feedback.
- **Screen calibration step**: New `screen_calibration` type with operator checklist and visual angle reference.

#### Templates
- **Stroop task**: 16-trial color-word Stroop with practice block, constrained randomization, jittered ITI.
- **Go/No-Go task**: 40-trial inhibition task (70/30 split) with practice block and jittered ITI.

#### Runtime & branching
- **Performance tracking**: Variables `last_accuracy`, `last_rt_ms`, `cumulative_accuracy`, `last_attention_passed`, `attention_fail_count` for adaptive experiments.
- **BIDS v1.8.0 export**: `bidsBundle()` generates BIDS-compliant behavioral directory structure.
- **Visual angle calculator**: `src/visualAngle.js` with `pixelsPerDegree`, `cmToVisualAngle`, `calibrationReport`, etc.
- **Flow snapshots**: Save/restore/rename/delete named flow states per trial (localStorage, last 20).

---

## [0.2.0] — 2026-07-03

### Added
- Initial public release.
- Visual flow editor with drag-and-drop nodes.
- Block → Trial → Step hierarchy with 4 order rules.
- 11+ step types with multi-language participant content.
- Media support (URL, YouTube, upload).
- Built-in questionnaire designer + external form support.
- Protocol validation, freezing, versioning, hash verification.
- Session runner with recovery, pause/resume, skip/retry.
- ZIP export with events, responses, analysis windows, stimulus manifest, integrity report.
- Analytics dashboard: timeline, response charts, cross-session compare.
- Lab readiness checklist.
- Local-first storage (File System Access API / Tauri desktop).
- Dark mode / light mode + system preference detection.
- Undo/redo, in-app guide panel.
- Emotion experiment template.
