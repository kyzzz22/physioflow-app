# Composer V2 与旧版编辑器功能差异分析

Date: 2026-08-23
Authority: `docs/SYSTEM_REFACTOR_PLAN.md` / 过渡期双轨（`IMPLEMENTATION_STATUS.md` 阶段 7）

Composer V2（Protocol Graph 编辑器）与旧版（Block→Trial→Step 编辑器，`FlowWorkspaceOverlay` / `FlowJsonEditor` / `Builder`）在迁移期并存。本文完整盘点两者的功能差异，作为补齐工作的 roadmap。

## 结论（TL;DR）

**差异不是单向的"新版不如旧版"，而是两侧各有强弱：**

- **旧版强在「实验设计能力」**：14 种 step、完整问卷设计器、zh/ja/en 三语、丰富画布交互（pan/zoom/snap/多选/小地图）、丰富的 Inspector、BIDS 导出、任务模板。
- **新版强在「架构工程能力」**：单一 Protocol Graph、确定性运行时 + 回放、组件 SDK / 设备连接器 / 控制处理器、协作变更集、托管部署、严格验证、可复现。

用户感知的"新版界面构建器不如旧版""没有双视图"，是「实验设计能力」这一侧的具体表现。

## 差异总表

| # | 类别 | 旧版 | 新版 | 性质 |
|---|---|---|---|---|
| 1 | 数据模型 | Block→Trial→Step（每 trial 可选 flow 图） | 单一 Protocol Graph | 范式差异 |
| 2 | 可视化编辑 | pan/zoom/snap/多选/复制粘贴/小地图/搜索/自动布局/流快照 | 同等核心能力已实现；缩放拖动换算、Shift 取消选择的隐藏目标已修复 | 核心持平 |
| 3 | 节点/步骤类型 | 14 step + 7 control（含 fixation/attention_check/manual_event/device_check/screen_calibration/custom_html/response/note/junction/timer） | 13 组件（缺上述，多 random split / value switch） | **旧版强（部分）** |
| 4 | 节点配置 | 极丰富（i18n 内容、外观覆盖、自定义 CSS、媒体、时间行为、恢复、分析窗口、规则编辑器） | editorFields 薄封装（text/select/number/boolean + showWhen） | **旧版强** |
| 5 | 界面构建 | step-type 决定（每 step 专用 UI） | PPT 式近似画布（元素添加/移动拖拽 + 属性面板 + 全屏节点编辑）+ 真实 `ParticipantRenderer` 预览 | 范式差异（预览为运行时真实渲染） |
| 6 | 问卷 | 完整设计器（9 题型、11 预设、条件跳过、拖拽排序、自动评分、VAS、CSV、多语言、共享库） | 新架构编辑器/运行器 + 冻结前 schema 校验 + 确定性随机 + 限时 + 评分输出 + 带引号 CSV | 核心持平 |
| 7 | 代码/JSON 编辑 | FlowJsonEditor（debounced 实时应用）+ Builder text 视图 | CodeView（JSON + apply） | 基本持平（旧版多 Builder text 视图） |
| 8 | 变量/条件/逻辑 | 规则编辑器 + 性能变量（accuracy/RT/attention）+ block 随机化 + ITI jitter | typed variables + condition/loop/random/value-switch | 各有强弱 |
| 9 | 模板/复用 | 任务模板（emotion/stroop/gonogo）+ stimuli/questionnaire 库 | Emotion/SAM + 专用 Stroop、Go/No-Go 认知任务节点 + node groups + 参数化 subflow templates | 新版已补齐三类模板 |
| 10 | 扩展机制 | custom_html（sandboxed iframe）+ custom_css | component SDK + device connectors + control handlers | **新版强** |
| 11 | 协作 | 无 | change sets | **新版强** |
| 12 | 部署/托管/云端 | 无 | deployment/hosted/bootstrap/HTTP/launch tokens | **新版强** |
| 13 | 撤销/重做 | App 级 + Canvas 级（每 trial）+ flow snapshots | App 级（单栈） | 旧版略强 |
| 14 | 预览/运行 | quick markers（9 种）+ interval markers + device sync + pre-run checklist + 节点双击预览 | pause/resume/retry/skip/snapshot/restore + 恢复 | 各有强弱 |
| 15 | 冻结/版本 | freeze/unfreeze + new version | freeze（immutable）+ new draft version | 新版略强（immutable 严格） |
| 16 | 导出/数据 | complete(10)/simplified(5)/BIDS | graph export（15 文件，JSONL+CSV） | 各有强弱（新版缺 BIDS） |
| 17 | 验证 | validateProtocol + validateFlow | validateProtocolGraph（三层） | 新版略强 |
| 18 | 迁移 | 无（被迁） | migrateLegacyProtocolV1 | 新版强 |
| 19 | i18n/主题 | zh/ja/en（300+ 条目）+ 6 色 5 布局主题预设 + dark mode | 无 i18n（硬编码）+ participant token 主题 | **旧版强** |
| 20 | 其他 | visual angle calculator、ITI jitter、analytics dashboard、onboarding | deterministic runtime、replay、性能门禁 | 各有强弱 |

## 需要补齐的（旧版有、新版缺）

按「实验设计能力」这一侧，从最痛到次要：

| 优先级 | 缺口 | 状态 | 备注 |
|---|---|---|---|
| 1 | **问卷设计器** | ✅ 已实现（新架构） | 新 `QuestionnaireEditorV2`（schema 化编辑）+ `QuestionnaireFormV2`（Runtime V2 渲染，条件跳过/评分/进度/VAS/Likert/NPS/CSV），消费 `src/core/questionnaireModel.js`，无旧版依赖 |
| 2 | **i18n（zh/ja/en）** | ✅ 已接入 | ComposerV2 核心 UI 文案走 `translate()`；词条已补 zh/ja；participant 问卷内容走 `prompt_i18n` |
| 3 | **节点类型覆盖** | 🔶 部分补齐 | 新增 `stimulus.fixation` / `stimulus.attention-check` / `setup.device-check` / `operator.manual-event`（schema 化注册 + 默认框架）；已补 screen-calibration / custom-html（Html 元素）/ note / junction |
| 4 | **按节点类型默认框架** | ✅ 已实现 | `participantUiTemplate` 扩展 rating/fixation/attention/device/manual 5 个默认框架；新节点创建即带 |
| 5 | **画布交互** | ✅ 已实现（核心） | pan/zoom（滚轮+ctrl、工具栏 1:1）、多选（shift-click + marquee 框选 + 拖动同移）、Ctrl+C/V/D 复制粘贴/重复、Delete 批量删除 |
| 6 | **Inspector 丰富度** | ✅ 已实现 | editorFields + 节点双击预览/内联编辑 + 通用「Analysis & recovery」高级段（分析角色/标签/恢复行为） |
| 7 | **任务模板** | ✅ 已实现并经语义验收 | Emotion 含条件平衡/SAM 三题/恢复段；Stroop 含颜色词、墨色、一致性与正确键；Go/No-Go 含 Go 比例、抑制窗口、漏报/误报结果 |
| 8 | **导出格式** | ✅ 已实现 | `buildGraphBidsBundle` 产出 BIDS v1.8.0（_events.tsv/_events.json/participants.tsv/dataset_description.json），并入运行导出包 |

## 新版已超越旧版的（架构优势，无需补）

- 单一 Protocol Graph（单一事实来源，可序列化/冻结/复现）
- 确定性运行时 + 事件回放（`replayRuntime`）
- 组件 SDK / 设备连接器 / 控制处理器（声明式、权限门控、无代码注入）
- 协作变更集（三方合并 + 冲突解析）
- 托管部署（bundle / hosted service / HTTP API / participant bootstrap / launch tokens）
- 严格三层验证 + 冻结不可变 + 性能门禁

## 与现有工作关系

- **已落地并通过本轮复核**：样式 token 系统、新增/已有元素拖拽、代码/JSON 双视图、PPT 式近似画布、真实运行时预览与全屏节点编辑。
- 节点/Inspector 扩展复用 `componentRegistry.js` 的 `editorFields`（含 group/help/color/asset/variable）/`defaultConfig.ui` 与 `participantUiTemplate`。
- 问卷用新架构实现（`questionnaireModel.js` 纯模型 + `QuestionnaireEditorV2`/`QuestionnaireFormV2`），不依赖旧版 UI 组件。
- i18n 复用旧版 `src/i18n.jsx` 词条表（共享基础设施，非 UI 组件）。
- 已补：实验节点（fixation/attention/device/manual/calibration/custom-html/note/junction）+ Html 元素、全屏节点编辑、BIDS、任务模板、性能变量回填、主题预设、stimuli 媒体库、visual angle、分析窗口/恢复字段、画布交互（pan/zoom/snap/多选/复制粘贴/搜索/自动布局/流快照/小地图）。
