# 实验设计能力 — 功能业务分析

Date: 2026-08-23
Scope: 专注「实验设计能力」（用户直接感知的内容/结构/呈现），不涉及架构工程（运行时/托管/协作，由另一侧负责）

## 1. 业务背景

PhysioFlow 的定位是「行为与生理实验的可视化工作流系统」。核心用户是**实验设计者**（研究者），他们的核心任务是把一个实验方案变成**可复现的 protocol**。

一次完整的实验设计包含三个轴：

```
实验设计 = 结构（怎么呈现顺序）× 内容（呈现什么）× 呈现（长什么样、什么语言）
```

- **结构**：block→trial→step 层级、随机化规则、practice 标志、ITI jitter、条件分支、循环。
- **内容**：刺激类型（注视/媒体/问卷/反应/注意检查…）及其具体内容（文字、媒体、量表）。
- **呈现**：多语言文案、主题外观、布局。

旧版在这三轴上都完整；新版把「结构」抽象成了更通用的节点图，但**丢了层级/随机化语义**，「内容」和「呈现」尚未补齐。下文按功能域逐一分析。

## 2. 功能域分析

### 2.1 问卷设计（最高优先级）

**业务需求**：行为/心理实验的核心工具是标准量表——SAM 情绪（valence/arousal）、Likert、NPS、VAS。设计者需要：一套题型、一键预设、条件跳过（"上一题选 X 才显示这题"）、自动评分、随机顺序、进度条、CSV 批量导入、多语言。

**现状**：旧版完整（9 题型、11 预设、拖拽排序、条件跳过、自动评分、VAS 滑块、CSV 导入、共享库、实时预览）。新版 `input.questionnaire` **完全空白**——无 editorFields、无渲染适配，迁移时也只是把 `questionnaire` 塞进 `config` 存着。

**缺口**：这是最大的单项缺口。问卷是实验设计的「高频、标准、用户最常碰」的内容。

**目标**：给 `input.questionnaire` 接一个 schema 化问卷设计器（题型/预设/条件跳过/评分/CSV），渲染侧把 `config.questionnaire` 映射成 participant UI。

### 2.2 刺激内容设计（节点类型 + 配置）

**业务需求**：实验设计者要能配置每种刺激的**类型**和**内容**。生理/行为实验的刚需刺激包括：注视十字（fixation）、注意力检查（attention_check）、操作员确认（manual_event）、设备检查（device_check）、屏幕校准（screen_calibration）、反应按键（response）、倒计时（timer）。

**现状**：旧版 14 种 step 各有专用配置面板（fixation 形状/颜色/脉冲、timer 环、response 选项、device_check 清单…）。新版只有 7 种可用的 participant 组件，缺 fixation/attention_check/manual_event/device_check/screen_calibration/response/note/junction，目前全靠 `legacy.step` 兜底。

**缺口**：
1. 节点类型覆盖不足（生理实验刚需节点缺失）。
2. Inspector 是薄封装（editorFields 五类控件），无法表达旧版那种「每个 step 有专属配置」。

**目标**：补齐刚需节点类型；给每个节点按类型配默认界面框架 + 专用配置字段。

### 2.3 多语言内容（i18n）

**业务需求**：研究被试可能来自多语言群体，participant 看到的内容（说明、问卷题、选项、标签）需要 zh/ja/en 三语。

**现状**：旧版 300+ 词条 + 每 step 的 `content_i18n`/`name_i18n` + 问卷多语言。新版 ComposerV2 **全部硬编码英文**，无 i18n 接入。

**缺口**：多语言是国际化研究的刚需，且是新旧版差距最大的「用户可见」项之一。

**目标**：接入旧版 `src/i18n.jsx` 词条；participant 内容支持按语言存储与切换。

### 2.4 实验结构设计（层级 + 随机化 + jitter）

**业务需求**：实验设计者需要表达**呈现顺序规则**，而不只是"节点连线"。典型需求：
- block 层级（一组 trial 的整体）与 trial 层级；
- 呈现顺序规则：fixed / random / latin_square / manual；
- 约束：`max_consecutive_same`、`no_immediate_repeat`；
- practice 标志（练习块不计入分析）；
- trial 内 ITI jitter（4 种分布）。

**现状**：旧版 Block→Trial→Step 层级完整，含上述全部规则。新版是单一 Protocol Graph——用 condition/loop/random 节点能表达部分逻辑，但**没有 block/trial 层级语义**、没有顺序规则、没有 practice 标志、没有 ITI jitter。

**缺口**：这是「实验设计」区别于「通用流程图」的本质语义。新版图模型更通用，但丢了实验设计的领域语义。

**目标**：在图模型上补回实验结构语义——最可能是用「组（group）+ 顺序策略」表达 block/trial 的随机化与 jitter，而非退回旧版的层级模型（避免与另一侧的架构方向冲突）。

### 2.5 逻辑与分支（性能变量）

**业务需求**：实验需要**自适应的分支**——根据被试的反应时（RT）、准确率（accuracy）、注意力检查结果来分支。设计者要在 condition 里引用这些运行时变量。

**现状**：旧版有性能变量（`last_accuracy`/`last_rt_ms`/`last_attention_passed`/`attention_fail_count` 等）。新版有 typed variables + condition/loop/random，但**运行时性能变量作为 condition 输入**这一层需要确认补齐。

**缺口**：性能变量是行为实验（尤其自适应范式）的关键。

**目标**：确认并补齐「运行时性能变量」可被 condition 引用。

### 2.6 外观与主题

**业务需求**：实验的视觉呈现（配色、字体、布局、深色模式）应可配置，且能复用主题预设。

**现状**：旧版 6 色 + 5 布局主题预设 + 协议级 theme + dark mode。新版有 participant-UI token 主题（本轮已做）+ 部分 dark，但**无主题预设、无协议级主题 UI**。

**缺口**：中低优先级——token 系统已搭好，补预设是增量工作。

### 2.7 导出（BIDS）

**业务需求**：数据要交给下游分析管线，BIDS v1.8.0 是神经影像/生理数据的标准格式。

**现状**：旧版有 BIDS。新版 graph export 有完整 JSONL/CSV/manifest/dictionary/quality report，但**无 BIDS**。

**缺口**：中低优先级——graph export 已经很强，BIDS 是格式适配层。

### 2.8 预览与验证

**业务需求**：设计者要能快速预览单个刺激、整个流程，并在运行前发现配置错误。

**现状**：新版有 preview run + 三层验证；缺**节点级双击预览**（旧版有，全屏预览单个节点 + 内联编辑）。

**缺口**：小——preview run 已覆盖大部分场景。

## 3. 优先级总览

| 优先级 | 功能域 | 业务价值 | 现状缺口 |
|---|---|---|---|
| P0 | 问卷设计 | 行为/心理实验核心，最高频 | 完全空白 |
| P1 | 刺激内容设计 | 生理实验刚需节点 + 配置 | 节点缺失 + inspector 薄 |
| P1 | 多语言 | 国际化被试刚需 | 全硬编码英文 |
| P2 | 实验结构设计 | 实验设计本质语义 | 无层级/随机化/jitter |
| P2 | 逻辑与分支 | 自适应实验 | 性能变量待确认 |
| P3 | 外观主题 | 视觉呈现 | 缺预设（token 已就绪） |
| P3 | 导出 BIDS | 数据交付 | 缺格式适配 |
| P3 | 预览 | 设计体验 | 缺节点级预览 |

## 4. 建议的落地顺序

> 原则：**新架构实现类似功能，不借鉴/不依赖旧版 UI 组件**。旧版组件留在旧版编辑器（过渡期），新架构只消费共享的纯模型（`questionnaireModel.js`、`i18n.jsx` 词条表这类基础设施）。

1. **问卷设计（P0）** —— 用新架构实现：`core/questionnaireModel.js` 纯模型 + `QuestionnaireEditorV2.jsx`（编辑）+ `QuestionnaireFormV2.jsx`（渲染），产出 `config.questionnaire`。
2. **按节点类型默认框架 + 刚需节点（P1 刺激内容）** —— 扩展 `participantUiTemplate(type)` + `componentRegistry`，schema 化注册新组件，让 fixation/attention_check/device_check 等节点开箱即用。
3. **i18n（P1）** —— 接入 `i18n.jsx` 词条（共享基础设施），ComposerV2 核心 UI 走 `translate()`，participant 内容走 `prompt_i18n`。
4. **实验结构语义（P2）** —— 纯函数层（`experimentStructure.js`）提供确定性随机化/jitter；专用 `experiment.cognitive-task` 运行器消费已生成的试次，不引入第二套 Block→Trial 图层级。
5. **P3 各项** —— 主题预设、BIDS、双击预览和画布交互已增量补齐。

> 依赖提示：第 2 项触及 `componentRegistry`，与另一侧（架构工程）可能共享文件，落地前需协调改动边界。

## 实现状态（2026-08-23）

| 功能域 | 状态 | 落点 |
|---|---|---|
| 问卷设计（P0） | ✅ 已实现并通过冻结校验 | 9 题型 / 11 预设 / 条件跳过 / 确定性随机 / 选项随机 / 限时 / 评分输出 / VAS / 带引号 CSV / 多语言 / 拖拽。新建节点立即持久化默认问卷，重复 ID、未知题型、空提示、非法量表和条件引用会阻止冻结。 |
| 刺激内容设计（P1） | ✅ 已实现 | 新增 `stimulus.fixation` / `stimulus.attention-check` / `setup.device-check` / `operator.manual-event`（schema 化注册 + 默认框架 + 专用 editorFields + 运行时适配）。`participantUiTemplate` 扩展 rating/fixation/attention/device/manual 5 个默认框架。 |
| 多语言（P1） | ✅ 已接入 | ComposerV2 核心 UI 走 `translate()`（zh/ja）；participant 内容走 `prompt_i18n`；问卷渲染按 `participant_language` 选语言。 |
| 实验结构语义（P2） | ✅ 已实现（功能层 + 认知任务运行器） | `createBlockOrder` + `createJitteredDuration` 提供确定性序列；`experiment.cognitive-task` 按试次执行 fixation/stimulus/response-window/ITI，记录 RT、正确率、omission/commission。 |
| 逻辑与分支（P2） | ✅ 已实现 | 运行时性能变量回填：声明 `last_rt_ms` / `last_response` 变量，响应时自动注入，condition 可引用做自适应分支。 |
| 外观主题（P3） | ✅ 已实现 | `ThemeEditor` 增加 5 个主题预设（Physio Green / Ocean Blue / Warm Amber / High Contrast / Minimal Mono），一键应用。 |
| 导出 BIDS（P3） | ✅ 已实现 | `buildGraphBidsBundle` 产出 BIDS v1.8.0（_events.tsv/_events.json/participants.tsv/dataset_description.json），并入运行导出包 |
| 节点级双击编辑（P3） | ✅ 已实现 | 双击节点打开**全屏节点编辑器**（PPT 式近似画布 + 属性面板 + 真实 `ParticipantRenderer` 预览切换） |
| 画布交互（完整） | ✅ 已实现 | pan/zoom + 多选 + 复制/粘贴/重复 + 批量删除 + **snap 网格吸附** + **节点搜索/定位** + **自动布局** + **流快照**（localStorage）+ **小地图** |
| 任务模板（emotion/stroop/gonogo） | ✅ 已实现并通过实验语义测试 | Emotion：条件平衡 + SAM 三题 + recovery + 唯一 ID；Stroop：颜色词/墨色/一致性/正确键/练习/jitter；Go/No-Go：Go 比例/抑制窗口/漏报与误报/练习/jitter |
| 共享问卷库 | ✅ 已实现 | `protocol.questionnaireLibrary` + 纯函数 `saveQuestionnaireToLibrary`/`removeQuestionnaireFromLibrary`，QuestionnaireEditor 内保存/加载/删除 |
| stimuli 媒体库 | ✅ 已实现 | `protocol.assets` 管理面板（列表/新增/删除），`display.media` 节点 Inspector 有 asset 选择器 |
| visual angle calculator | ✅ 已实现 | 复用 `visualAngle.js`，ComposerV2 提供像素/度换算面板 |
| 分析窗口/恢复策略 Inspector 字段 | ✅ 已实现 | 所有节点通用「Analysis & recovery」段：分析角色/标签 + 恢复行为 |

## 节点编辑体验修复（2026-08-23）

| 问题 | 修复 |
|---|---|
| 配置 vs 界面双源割裂 | media/rating/text 内容字段改为直接编辑 ui 元素（ContentField），并同步写回 `config`，运行时覆盖仍一致——用户只有一个编辑入口 |
| 无连续 WYSIWYG 预览 | NodeInspector 顶部内嵌 `ParticipantRenderer` 实时预览（共享 `schemaForNode`），随编辑实时更新 |
| 字段类型单一 | editorFields 通用支持 `color`（颜色选择器+hex）、`asset`（协议资产选择）、`variable`（变量选择）类型 |
| 字段平铺无分组 | editorFields 支持 `group`（折叠分组）与 `help`（字段说明）；节点显示 Records（记录事件 + 导出数据列） |
| 空节点无引导 | 缺关键内容时显示引导提示（如 media 无源 → "Add a source URL…"） |
| 删除无确认 | 删除节点/批量删除前弹确认条，防误删 |
| 双击进入编辑难用 | 双击节点直接进入**全屏节点编辑器**（替代窄 popup），PPT 式画布编辑 + 侧栏属性面板，编辑与查看效果都宽敞 |
| 左侧不能拖拽元素 | palette 元素支持 HTML5 拖拽到画布指定位置（`addNodeAt` 按 drop 坐标放置），点击添加保留 |

落点：`ComposerV2.jsx`（NodeInspector 重构 + ContentField/color/asset/variable 渲染 + 删除确认条）、`componentRegistry.js`（editorFields 加 group/help、media/rating/text 内容字段移交 ContentField）、`composer-v2.css`。

## 参与者界面编辑器：PPT 式画布编辑（2026-08-23）

将 `ParticipantUiBuilder` 从"树列表 + 添加按钮"重构为 **PPT 式画布编辑器**：

- **PPT 式近似画布**（`ParticipantUiCanvas.jsx`）：复用 theme/style/bindings 并支持元素直接操作；工具栏 Preview 使用真实 `ParticipantRenderer`，是运行时效果的权威预览。
- **元素库可拖拽**：左侧元素库（Text/Media/Input/Button/Progress/Layout/Html）可拖到画布任意容器添加，或点击追加。
- **画布内移动/重排**：拖已有元素到目标容器移动（`insertUiElement`/`moveUiElement` 按位置插入）。
- **侧栏属性面板**：选中元素后编辑内容属性/样式/绑定/按钮动作 + 上移/下移/删除。
- **每节点默认模板底板**：`UI_TEMPLATE_KIND` 映射每类节点默认模板（rating→rating、media→media、text→text、fixation→fixation…），工具栏可切换模板 + 一键 Reset template 恢复底板。
- 预览（ParticipantRenderer）/结构树（折叠）保留；ThemeEditor 恢复。
- **全屏节点编辑**：双击节点打开全屏编辑器（`node-editor-fullscreen`），顶部工具栏（节点名/Edit↔View/Done），编辑态渲染完整 PPT 式三栏（元素库 + 大画布 + 属性面板），查看态居中大预览。

落点：`ParticipantUiCanvas.jsx`（新）、`ParticipantUiBuilder.jsx`（重构）、`participantUi.js`（`insertUiElement` + `text` 模板）、`componentRegistry.js`（rating/text 默认模板）、`ComposerV2.jsx`（全屏 overlay）、`composer-v2.css`。

## 节点功能业务审查（2026-08-23）

以下是超出本轮“画布/问卷/任务模板”范围的全节点业务审查待办。分三级：P0 实际 Bug、P1 业务能力缺口、P2 体验问题；已在上方实现状态表中验收的项目不再归入此处“全部待修复”结论。

### 🔴 P0 — 实际 Bug：字段存在但功能没实现/不可用

| 节点 | 问题 | 证据 |
|---|---|---|
| display.media | ✅ 已修复（2026-08-24）：Inspector 新增 `completion.mode` 选择器（manual/fixed/media-ended），durationMs 仅 fixed 显示；media-ended 运行时自动推进且 schema 移除提前推进按钮；验证层校验非法 mode | `componentRegistry.js` media editorFields + `nodeSchema.js` + `freezeProtocolGraph.js` |
| stimulus.fixation | ✅ 已修复（2026-08-24）：`schemaForNode` 按 shape 渲染 `+`/`●`/`◆`，pulse 走 `participant-pulse` CSS 动画；验证层校验非法 shape | `nodeSchema.js` + `ParticipantRenderer.jsx` + `participant-ui.css` + `freezeProtocolGraph.js` |
| stimulus.attention-check | ✅ 已修复：`AttentionCheckRunner` 实现真实按键检测 + 反应时 + 超时判定 + pass/fail 反馈，写回 `last_attention_passed` | 见「审查问题修复」 |
| operator.manual-event | ✅ 已修复（2026-08-24）：`requireNote=true` 时 schema 渲染必填备注 textarea（name=note），提交记录 note | `nodeSchema.js` |
| setup.device-check | ✅ 已修复（2026-08-24）：checklist 每项渲染为必选 checkbox，全部勾选才能提交（`ParticipantRenderer` 新增 checkbox 分支） | `nodeSchema.js` + `ParticipantRenderer.jsx` |

### 🟠 P1 — 业务能力缺口（实验设计需要但缺失）

| 节点 | 问题 |
|---|---|
| logic.condition | ✅ 已修复（2026-08-24）：新增可选 `compare` 数据输入端口（变量 vs 变量），运行时按 compare 端口求值；`expected` 字段类型随绑定变量类型（number/boolean 专用输入，其余 text）。注：原"10 > 9 变假"子项已由 `expression.js` 的 `Number()` 强转保证数值比较正确 |
| logic.random | ✅ 已修复（2026-08-24）：新增可选 C/D 输出端口与每分支权重（probabilityA–D），运行时按已连接分支归一化选择，向后兼容 `probabilityA`。block 级 latin_square / 连续约束仍由 `experimentStructure` 提供，任务模板消费 |
| logic.loop | ✅ 已修复（2026-08-24）：新增可选 `until` 数据输入端口 + untilRule（操作符/期望值），规则失败即退出，maxIterations 仍作上限 |
| input.rating | 🔶 已知边界：`input.rating` 仍是数字按钮排；Likert 两端标签 / VAS 滑块请使用 `input.questionnaire`（已支持 likert/vas_slider），避免重复实现 |
| 通用 graph 无 trial 语义 | 已知边界：Stroop/Go-NoGo 已由 `experiment.cognitive-task` 封装可执行试次、practice 和 ITI jitter；任意节点组合的 trial 语义属后续能力 |
| screen-calibration | ✅ 已修复（2026-08-24）：新 `CalibrationRunner` 接入 `visualAngle`，按真实视口 + 屏幕物理尺寸计算 pixels-per-degree，渲染 2° 参考刺激，确认后把 `calibration_report`（ppd/参考尺寸）写入响应并回填 `pixels_per_degree` 变量 |
| questionnaire 评分 | ✅ 本轮已修复：`questionnaire_score_correct/total/pct` 随提交输出，并作为运行时变量供下游分支使用 |
| legacy.step | ✅ 已修复（2026-08-24）：`legacy.step` 注册 content/name editorFields，迁移节点可在 Inspector 编辑名称与纯文本内容 |

### 🟡 P2 — 体验 / 可用性问题

| 问题 |
|---|
| media URL / assetId 无校验无预览——无效 URL 只在运行时 `media_error` 才发现 |
| 数据流不可见：节点 data 端口/变量绑定，用户看不到"该节点输出是什么、接给谁" |
| 完成模式在各节点间不一致且暴露不全（screen 有 manual/fixed、media 只有 fixed、questionnaire 直接 submit） |
| validation 错误只显示前 8 条、英文、代码式 |
| condition 的变量选择器只列协议变量，无法引用上游节点输出 |

### 建议修复优先级

1. **先修 P0 的 5 个字段摆设**（成本低，把已暴露的配置变真）：media `media-ended` 选项；fixation shape 真渲染或删字段；attention-check 接运行时按键检测+超时+`attention_result`（生理实验刚需，旧版亦欠）；manual-event `requireNote`→备注框；device-check→逐项 checkbox。
2. **再补 P1 最影响实验设计的**：condition 双变量比较 + expected 类型随变量、问卷评分写回变量、trial 语义（group 加 trial kind + practice 标志 + jitter 接入）。
3. P2 体验项按需增量。

## 审查问题修复（2026-08-23）

对另一侧 agent 的认知任务/问卷改动审查后发现的 7 个问题，已全部修复：

| 问题 | 修复 | 落点 |
|---|---|---|
| 🔴 问卷最后一题限时超时提交丢当前题答案 | 用 `answersRef` 同步最新答案，超时提交读 ref | `QuestionnaireFormV2.jsx` |
| 🟠 cognitive-task 手动添加 trials 空不可用 | NodeInspector 加 **Generate trials** 按钮（调用 `generateStroopTrials`/`generateGonogoTrials` 填充 config） | `ComposerV2.jsx` + core 导出 |
| 🟠 认知任务结果未写回变量 | `CognitiveTaskRunner.finishTask` 显式传 `variables: { mean_rt_ms, accuracy_pct, omissions, commissions }`，condition 可引用做自适应 | `CognitiveTaskRunner.jsx` |
| 🟡 CSV required 默认 true | 改为仅 `true/1/yes` 显式才必填，空默认非必填 | `questionnaireModel.js` |
| 🟡 CognitiveTaskRunner finishTask 用 state 闭包 | 改用 `resultsRef`，消除 setResults 异步竞态 | `CognitiveTaskRunner.jsx` |
| 🟡 practice 数据未标记 | trial result 携带 `practice` 标志，导出可区分练习数据 | `CognitiveTaskRunner.jsx` |
| 🟡 attention-check 字段摆设 | 新 `AttentionCheckRunner`：真实按键检测 + 反应时 + 超时判定 + pass/fail 反馈（延迟提交），variables 写回 `last_attention_passed` | 新 `AttentionCheckRunner.jsx` + `GraphRuntimeRunnerPage.jsx` 接入 |

## 组件与运行时验收修复（2026-08-24）

针对「组件体系与运行时功能验收」发现的问题全部修复：

| 项 | 修复 | 落点 |
|---|---|---|
| 🔴 media `media-ended` 不可选 | Inspector 增加 `completion.mode`（manual/fixed/media-ended），durationMs 仅 fixed 显示；media-ended 移除提前推进按钮；验证层校验 mode | `componentRegistry.js`、`nodeSchema.js`、`freezeProtocolGraph.js` |
| 🔴 fixation shape/pulse 无效 | `schemaForNode` 按 shape 渲染 `+`/`●`/`◆`，pulse 走 `participant-pulse` 动画类；验证层校验 shape | `nodeSchema.js`、`ParticipantRenderer.jsx`、`participant-ui.css` |
| 🔴 manual-event `requireNote` 无效 | requireNote=true 渲染必填备注 textarea（name=note），提交记录 | `nodeSchema.js` |
| 🔴 device-check 非逐项勾选 | checklist 每项渲染为必选 checkbox，全部勾选才能提交（`ParticipantRenderer` 新增 checkbox 分支） | `nodeSchema.js`、`ParticipantRenderer.jsx` |
| 🟠 condition 变量 vs 变量 | 新增可选 `compare` 数据输入端口 + Inspector「Compare with variable」选择器；运行时优先用 compare 端口求值 | `componentRegistry.js`、`runtimeMachine.js`、`ComposerV2.jsx` |
| 🟠 condition `expected` 类型不随变量 | Inspector 的 expected 按绑定变量类型渲染（number/boolean 专用输入） | `ComposerV2.jsx` |
| 🟠 random 仅两路 | 新增可选 C/D 输出端口 + probabilityA–D 权重，运行时按已连接分支归一化选择，向后兼容 | `componentRegistry.js`、`runtimeMachine.js` |
| 🟠 loop 无 until-fail | 新增可选 `until` 端口 + untilRule，规则失败即退出 | `componentRegistry.js`、`runtimeMachine.js`、`ComposerV2.jsx` |
| 🟠 screen-calibration 无真实校准 | 新 `CalibrationRunner` 接入 `visualAngle`，真实视口计算 ppd + 2° 参考刺激 + 报告写回 | `CalibrationRunner.jsx`（新）、`GraphRuntimeRunnerPage.jsx` |
| 🟠 legacy.step 无配置界面 | 注册 content/name editorFields | `componentRegistry.js` |

回归：全套 218 测试通过、lint 零警告、生产构建无警告、refactor-e2e + 性能门禁通过。
