# PhysioFlow 后续优化计划书（2026-08）

> 适用范围：排除「正式可用性研究（真人被试）」之外的工程化与产品化优化。
> 状态：计划阶段 · 目标分支：`demo` · 关联文档：`IMPLEMENTATION_STATUS.md`、`COMPOSER_V2_GAP_ANALYSIS.md`、`RELEASE_CHECKLIST.md`

## 1. 背景与总体目标

重构阶段 0–6 已全部落地，CI 质量门（ubuntu + Node 22 + Chrome）保持绿色，222+ 自动化测试通过，本地性能目标达标（500 节点校验/编辑 ~36ms、1 万事件导出 ~39ms）。本计划聚焦于剩余工程化短板与产品化差距，共 5 个工作包：

| 编号 | 工作包 | 类型 | 优先级 |
|------|--------|------|--------|
| W1 | 当前 WIP 收尾 | 工程 | P0 |
| W2 | Windows 本地测试全绿 | 工程 | P0 |
| W3 | 大文件拆分（可维护性重构） | 质量 | P1 |
| W4 | 渲染性能优化 | 性能 | P1 |
| W5 | 体验差距补齐 + Stage 7 剩余项 | 产品 | P2 |

依赖关系：`W1 → W2 → W3`（W3 依赖干净的基线）；W4 可与 W3 并行（W3 拆分完成后对拆分结果再做一次 W4 微调）；W5 依赖 W3 提供的模块边界。

## 2. W1 — 当前 WIP 收尾（P0）

### 目标
将工作区未提交的进行中改动落盘并验证，恢复干净的发布基线。

### 现状
- `src/ComposerV2.jsx`（+63）、`src/App.jsx`（+4）、`src/composer-v2.css`（+1）、`package.json`（+1）
- 新增未跟踪：`.playwright-cli/verify-interactions.cjs`
- 内容涉及：ComposerV2 拖拽连线、Escape 键语义修复、交互验证脚本与 `test:interactions` 脚本入口

### 任务
- [ ] 本地执行 `npm run quality:release`（单元测试 + 构建 + 零警告 lint + 3 条浏览器 E2E）
- [ ] 运行 `npm run test:interactions` 验证交互回归脚本，确认结果与预期一致
- [ ] 复核拖拽连线的操作语义（悬停吸附端口、Esc 取消、连线成功/失败反馈）
- [ ] 按功能点拆分提交（先逻辑后文档），提交信息遵循现有惯例
- [ ] 确认 `git status` 干净，CHANGELOG/状态文档与本次改动同步

### 验收标准
- `git status` 无未提交改动（除预期忽略文件）
- 本地 `quality:release` 全绿，CI 同步绿
- 拖拽连线 / Esc 交互行为与 verifier 断言一致

### 风险与回退
- 若交互 verifier 与真实行为不一致：先修 verifier 再合入，避免把错误行为固化为验收断言
- 若 `quality:release` 在 Windows 本地出现既有红（见 W2），先记录原因，不阻塞 W1 提交

## 3. W2 — Windows 本地测试全绿（P0）

### 目标
消除 Windows 开发机上的已知测试红，使 `npm test` 在 win32 与 CI（POSIX）行为一致。

### 现状（已知两处）
- `tests/hosted-node-server.test.js:98`：`assert.equal((await stat(...)).mode & 0o777, 0o600)`
  - Windows 上 `mode` 返回 `0o666`（438），因 NTFS 无法表达 POSIX 权限位 → `438 !== 384`
- `tests/hosted-backup.test.js:28-29`：对 `state.json`、`assets/bundle_1/asset_1` 的同类权限断言，同样在 Windows 失败
- 符号链接用例（`hosted-backup.test.js:57`）已内置 `process.platform === 'win32'` 跳过逻辑，无需改动

### 任务
- [ ] 新建共享测试助手（如 `tests/helpers/assertFileMode.js`）：`assertFileMode(path, expectedMode)`
  - POSIX：断言 `mode & 0o777 === expectedMode`（保持 CI 严格性）
  - win32：显式跳过该断言并输出原因（`t.skip` 或打印已知限制），其余断言继续执行，不整例跳过
- [ ] 将 `hosted-node-server.test.js:98` 与 `hosted-backup.test.js:28-29` 替换为助手调用
- [ ] 在 Windows 与 POSIX 各跑一次 `npm test`，确认无新增红
- [ ] （可选）CI 增加 `windows-latest` 矩阵作业（仅单元测试），让平台差异在 CI 可见

### 验收标准
- Windows 本地 `npm test` 100% 通过
- Linux CI 权限断言严格性不降低

### 风险与回退
- 若后续新增权限相关测试，必须走同一助手，禁止复制粘贴断言
- 若 CI 矩阵引入维护成本，可保持「文档记录 + 本地兼容」不扩展矩阵

## 4. W3 — 大文件拆分（可维护性重构，P1）

### 目标
在不改变任何行为的前提下，把巨型文件拆到可维护的粒度，为 W4/W5 提供模块边界。

### 现状（行数）
| 文件 | 行数 | 拆分方向 |
|------|------|----------|
| `src/ComposerV2.jsx` | 1568 | 画布 / 检视器 / 组件面板 / 工具栏 / 状态 hooks |
| `src/FlowCanvas.jsx` | 1352 | 布局引擎 / 渲染 / 交互（拖拽、框选、键盘） |
| `src/App.jsx` | 1121 | 快捷键 hook / undo-redo hook / 视图编排 |
| `src/ParticipantUiBuilder.jsx` | 918 | 组件树编辑器 / 预览 / 状态 |
| `src/style.css` | 1774 | 设计令牌 + 按区块拆分 |
| `src/flow.css` | 1411 | 按画布区块拆分 |
| `src/composer-v2.css` | 457 | 随组件拆分并置 |

### 原则与边界
- **纯行为保持**：拆分只允许「移动代码 + 重新导出」，禁止顺手改逻辑；每步提交前跑 `npm test` + lint
- **架构约束不破坏**：`core/runtime/data` 模块仍不得 import React；拆分仅作用于 UI 层
- **先安全后激进**：先拆 `App.jsx`（hooks 抽取，零结构风险）→ `FlowCanvas.jsx` → `ComposerV2.jsx` → `ParticipantUiBuilder.jsx` → CSS

### 任务
- [ ] 抽取 `src/app/useGlobalShortcuts.js`（App.jsx 的全局键盘处理）
- [ ] 抽取 `src/app/useUndoRedo.js`（App 级 undo/redo 栈，作为 W5 编辑器级作用域的地基）
- [ ] 建立 `src/flowCanvas/`：`layout.js`（自动布局/吸附/坐标换算纯函数）、`FlowCanvas.jsx`（渲染+交互）、`interactions.js`
- [ ] 建立 `src/composer/`：`state.js`（选中/待连/拖拽/搜索 hooks）、`Canvas.jsx`、`Inspector.jsx`、`Palette.jsx`、`Toolbar.jsx`、`ComposerV2.jsx`（编排根）
- [ ] 拆分 `ParticipantUiBuilder.jsx` 为 `tree/`、`preview/`、`useParticipantUiState.js`
- [ ] CSS：建立 `src/theme/tokens.css`（双主题设计令牌：颜色/间距/圆角/阴影/动效），替换两套主题硬编码；`composer-v2.css` 随组件拆分
- [ ] 每个拆分步骤独立提交，提交信息注明「纯移动」与对应测试范围

### 验收标准
- 全部步骤完成后 `npm run quality:release` 通过，测试数量不减
- `git log` 每步可独立回退
- 拆分后单文件上限 < 600 行（CSS 除外，按区块 < 400 行）
- `ComposerV2.jsx` 对外导出的 props 契约与拆分前完全一致

### 风险与回退
- 最大风险：ComposerV2 处于活跃迭代区，拆分时若遇到未提交改动需先 W1 落盘
- 回退策略：每步独立提交，任何一步红即 `git revert` 单步，不连锁回退

## 5. W4 — 渲染性能优化（P1）

### 目标
在不牺牲可读性的前提下，降低大图交互（≥500 节点）的渲染延迟与内存占用，并把交互延迟纳入性能门禁。

### 现状
- 数据层性能已达标（校验/导出 < 2s / 3s），但 React 渲染层在每次交互时可能全量重渲染节点卡片
- `App.jsx` 已对视图做 `React.lazy` 拆包（Analytics/GuidePanel/ComposerV2/FlowWorkspaceOverlay/Runner 等），首屏无需再动
- 性能门禁已有 `tests/performance-gates.test.js`（500 节点校验编辑、1 万事件导出）

### 任务
- [ ] 节点卡片 `React.memo`：仅当 `node/edges/selected/pendingPort/ports` 引用变化时重渲染
- [ ] `nodeLabelById`、端口表等派生数据用 `useMemo`，消除每次渲染重建
- [ ] undo/redo 入栈节流：连续高频编辑（如拖拽 move 事件）合并为单条历史
- [ ] 画布平移/缩放走 CSS transform 合成层，避免节点坐标驱动全量重排
- [ ] 扩充性能门禁：新增「500 节点图拖拽/编辑节点交互耗时」与「节点标签编辑」两个用例（沿用 `performance-gates.test.js` 的 `performance.now()` 断言风格，给足余量）
- [ ] 若常见协议 > 1000 节点成为常态，再评估画布虚拟化（本计划不默认实施）

### 验收标准
- 新增性能用例在 CI 上稳定绿（给足余量，避免 flaky）
- 500 节点图交互无感知卡顿（Chrome DevTools 帧时间 < 50ms）
- 所有优化均保留 React 可访问性（aria 标签不因 memo 丢失）

### 风险与回退
- memo 过期导致「改了数据界面不刷新」：用引用不可变性约束 + 关键路径回归测试兜底
- 门禁余量过紧引发 flaky：以 CI 平均值的 3 倍标准差留余量

## 6. W5 — 体验差距补齐 + Stage 7 剩余项（P2）

### 目标
补齐差距分析中「旧版略强」的产品点，并落地 Stage 7 中与单机本地 MVP 相关的剩余项。

### 差距补齐
- [ ] **编辑器级 undo/redo 作用域**：当前仅 App 级单栈（`ComposerV2.jsx:818-819` 接 `onUndo/onRedo`）。复用 W3 抽取的 `useUndoRedo`，将「进入编辑器后的操作」按编辑器会话分组，避免与全局操作混栈
- [ ] **全视图 i18n**：目前仅 ComposerV2 核心走 `translate()`。将 `src/i18n.jsx`（或同源方案）扩展到 Dashboard、SessionManager、Analytics、Guide、Onboarding、两个 Runtime Runner 页面；文案键复用现有体系，中文先行、日/英为可选里程碑

### Stage 7 剩余项（单机范围）
- [ ] **运行中变量检查器**：Runtime V2 运行时面板提供实时变量/输出/分支走向查看（复用 `runtimeMachine` 快照与事件流）
- [ ] **高级界面动画与响应式布局**：编辑器过渡动画（面板展开/拖拽吸附反馈）、宽屏/窄屏布局适配

### 明确不做（保留文档说明）
- 在线多人协作、云执行：仍属 Stage 7 之外，不在本计划范围

### 验收标准
- 编辑器 undo/redo 作用域隔离：切出编辑器后历史栈不残留编辑器操作
- i18n：ComposerV2 之外视图的硬编码中文收敛到翻译键，缺译回退英文
- 运行中变量检查器在 `runtime-v2` 测试基础上新增 1 条断言用例

### 风险与回退
- undo 作用域改动涉及历史栈语义，优先保证「撤销结果等价」；若有争议以小步提交并保留原栈降级开关

## 7. 排期与里程碑

| 里程碑 | 内容 | 建议周期 |
|--------|------|----------|
| M1 | W1 收尾 + W2 全绿 | 0.5 周 |
| M2 | W3 拆分完成（App → FlowCanvas → ComposerV2 → ParticipantUiBuilder → CSS） | 2–3 周 |
| M3 | W4 性能优化 + 门禁扩充 | 1 周（与 M2 部分并行） |
| M4 | W5 差距补齐 + Stage 7 项 | 2–3 周 |

每里程碑结束执行一次 `npm run quality:release`；M2 每步提交均须单独绿。

## 8. 全局质量门与工具

- 每个工作包合并前：`npm test` + `npx eslint .`（零警告）+ `npm run build` + 3 条浏览器 E2E
- 交互相关改动：额外运行 `.playwright-cli/verify-interactions.cjs`
- 性能相关改动：`tests/performance-gates.test.js` 全绿且新增用例
- 文档同步：CHANGELOG.md、`IMPLEMENTATION_STATUS.md` 随工作包更新
