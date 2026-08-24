# 组件体系与元素功能 · 验收审查报告

Date: 2026-08-24
Method: 遍历全部 22 个组件，逐项核对注册契约、参与者 UI、运行时执行、形式验证与控制流；由 `tests/component-acceptance.test.js`（6 项）系统化验收，叠加全量 222 项测试 + 三浏览器 E2E。
Related: `EXPERIMENT_DESIGN_ANALYSIS.md`、`COMPOSER_V2_GAP_ANALYSIS.md`、`IMPLEMENTATION_STATUS.md`

## 1. 验收范围与方法

| 维度 | 手段 |
|---|---|
| 注册契约 | 全部组件已注册、`validateComponentDefinition` 通过、editorFields 路径可解析、默认 UI 存在且通过 `validateParticipantUi` |
| 完成策略 | 需手动/输入完成的组件默认模板含提交按钮；时长类组件默认有合法时长 |
| schemaForNode | 每个 participant 组件经 `schemaForNode` 生成的参与者 UI 有效 |
| 运行时 | 16 个 participant 组件线性串联端到端执行；condition/loop/random/value-switch 控制流路由正确 |
| 形式验证 | 含全部组件的图通过 `validateProtocolGraphConfiguration`（冻结前门禁） |
| 专项 | 媒体（直链/资产/YouTube）、自由布局、认知任务、注意力检查、屏幕校准 |

## 2. 组件总览矩阵（22 个，全部 ✅）

| 组件 | 运行时 kind | 适配器 | 完成策略 | 关键已验证功能 |
|---|---|---|---|---|
| `core.start` | start | — | — | 图入口，`protocol_started` 事件 |
| `core.end` | end | — | — | 终止并 `protocol_completed` |
| `logic.condition` | condition | — | — | 变量对变量/变量对常量、9 操作符、类型化 expected、true/false 路由 |
| `logic.loop` | loop | — | — | `maxIterations` 有界 + 可选 until 规则（循环直到规则失败） |
| `logic.random` | random | — | — | 2–4 路分支（A/B/C/D）、权重归一化、确定性 seed/draw、审计字段 |
| `logic.value-switch` | handler | — | — | match/default 路由（control handler 契约） |
| `display.screen` | participant | screen | config | 标题/内容；完成 manual/fixed |
| `display.media` | participant | media | config | 图片/音频/视频/**YouTube**；完成 manual/fixed/media-ended；本地资产解析 |
| `input.rating` | participant | rating | submit | 数字评分；ContentField 编辑 min/max/required；RT 记录 |
| `input.text` | participant | text | submit | 文本框；placeholder/required/multiline |
| `input.questionnaire` | participant | schema | submit | 9 题型/11 预设/条件跳过/评分/限时/VAS/CSV/多语言 |
| `timing.wait` | participant | wait | durationMs | 时长自动推进，无需手动 |
| `stimulus.fixation` | participant | schema | config | shape(cross/dot/diamond)/size/color/**pulse 动画** |
| `stimulus.attention-check` | participant | schema | submit | 专用 runner：真实按键、RT、超时 omission、pass/fail、写回变量 |
| `setup.device-check` | participant | schema | submit | 逐项必选 checkbox，全部勾选才能继续 |
| `operator.manual-event` | participant | schema | submit | 确认按钮 + `requireNote` 必填备注框 |
| `stimulus.screen-calibration` | participant | schema | submit | 专用 runner：visualAngle 计算 ppd、2° 参考刺激、报告写回 |
| `stimulus.custom-html` | participant | schema | config | Html 元素（沙箱 iframe）+ Continue 按钮（默认可冻结） |
| `utility.note` / `utility.junction` | participant | schema | config | 占位/透传，参与者不可见 |
| `experiment.cognitive-task` | participant | none | submit | 专用 runner：Stroop/Go-NoGo 试次、RT/正确率/漏报误报、practice |
| `legacy.step` | participant | schema | submit | 迁移节点；name/content 可编辑 |

## 3. 专项验收结果

### 3.1 媒体播放（本轮修复后全链路可用）
- **直链 URL**：`<video>/<audio>/<img>` 原生渲染，`media_started/ended/error` 事件齐全
- **YouTube**（watch / youtu.be / shorts / embed）：`ParticipantMedia` 用 youtube-nocookie iframe 嵌入，postMessage 上报 start/ended/error，`media-ended` 完成模式照常推进
- **本地资产**：选资产联动写回 `sourceUrl`（自包含）；运行器/预览经 `localResourceManifest` 解析 `protocol.assets`
- media 完成模式 Inspector 可选 manual / fixed / **media-ended**；media-ended 移除提前推进按钮

### 3.2 自由布局（画面编辑）
- Screen/Layout 勾选 **Free layout** → 子元素立即交错铺开为可拖拽 x/y
- **指针拖拽**重排（mousedown+move+up），元素实时跟随光标，松开落位
- 元素库点击添加自动给坐标；X/Y 数值框微调；取消勾选恢复流式
- free 容器强制 `min-height`，杜绝绝对定位高度塌缩

### 3.3 认知任务（Stroop / Go-NoGo）
- 确定性试次生成（`createBlockOrder` + jitter + 连续约束）；Generate trials 按钮填充
- 试次级事件 `trial_started/trial_response`；汇总 `accuracy_pct/mean_rt_ms/omissions/commissions` 写回变量
- practice 标记随结果导出；形式验证拒绝空试次/非法试次语义

### 3.4 注意力检查
- 专用 `AttentionCheckRunner`：keydown 检测、RT 测量、超时 omission、pass/fail 反馈
- 写回 `last_attention_passed`/`last_attention_rt_ms` 供 condition 自适应

### 3.5 屏幕校准
- 专用 `CalibrationRunner`：真实视口 + 屏幕物理尺寸 → `pixelsPerDegree`；渲染 2° 参考刺激
- 确认后 `calibration_report`（ppd/参考尺寸）写入响应并回填 `pixels_per_degree` 变量

## 4. 已知限制（非阻塞，已文档化）

| 限制 | 说明 |
|---|---|
| `input.rating` 仅数字按钮 | Likert 两端标签 / VAS 滑块请用 `input.questionnaire`（已支持） |
| 通用 graph 的 trial 语义 | Stroop/Go-NoGo 由 `experiment.cognitive-task` 封装；任意节点组合的 trial 语义属后续能力 |
| `legacy.step` 运行时渲染 | 迁移节点运行时呈现通用说明模板 + 节点名（旧内容不直接渲染），name/content 可在 Inspector 编辑 |
| schemaForNode 重建的节点 | `device-check`/`manual-event`/`media-ended` 等会重建 children；这类结构化节点以内容为主，自定义自由布局可能在运行时被重建覆盖 |

## 5. 测试与门禁基线

- 单元/契约：`tests/component-acceptance.test.js`（6 项）+ 全量 **222 项**全部通过
- lint：`--max-warnings=0` 零警告
- 构建：生产构建无 bundle 警告
- 浏览器 E2E：旧版兼容 / Composer V2 / 公开被试三条流全部通过
- 性能门禁：500 节点编辑 ≈36ms、万事件导出 ≈39ms（低于 2s/3s 上限）

## 6. 结论

全部 22 个组件完成功能验收，**无阻塞缺陷**。注册契约、参与者 UI、运行时执行、形式验证、控制流均通过系统化测试。媒体（含 YouTube）、自由布局、认知任务、注意力检查、屏幕校准为本次重点修复并已复验。
