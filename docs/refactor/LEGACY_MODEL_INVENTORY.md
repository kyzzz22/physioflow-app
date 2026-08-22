# 旧模型清单与迁移方向

## 1. 当前事实来源

旧协议使用 `Protocol → Block → Trial → Steps` 保存内容，同时在每个 Trial 的 `flow.nodes/edges` 保存执行顺序。Event Node 通过 `step_id` 引用 Step，因此两者可能不一致。

## 2. 顶层字段

| 旧字段 | 新位置 | 策略 |
| --- | --- | --- |
| `schema_version` | `schemaVersion` | 升级为新图 schema 版本 |
| `protocol_id` | `protocolId` | 保留值并记录 legacy ID |
| `project_id` | `projectId` | 保留 |
| `name` | `metadata.name` | 直接迁移 |
| `version/version_name/status` | `version` | 规范化版本对象 |
| `created_at/updated_at/frozen_at` | `audit` | 直接迁移 |
| `config_hash` | `freeze.configHash` | 重新按新 canonical schema 计算 |
| `theme` | `participantUi.theme` | 仅迁移实际有消费者的字段 |
| `stimuli` | `assets` | 生成资源引用与校验信息 |
| `questionnaires` | `templates` | 转换为 UI 组合模板 |
| `blocks` | `graph` | 转换为容器和子流程节点 |

## 3. Block 字段

| 旧字段 | 新表达 |
| --- | --- |
| `block_id/name/description` | container node 的 ID 与 metadata |
| `order_rule=fixed` | sequence container |
| `order_rule=random` | randomize container + policy |
| `order_rule=latin_square` | counterbalance container + row input |
| `order_rule=manual` | order input variable |
| `repeat_count` | repeat policy |
| `is_practice` | metadata.tags |
| `max_consecutive_same/no_immediate_repeat` | randomization constraints |

## 4. Trial 字段

| 旧字段 | 新表达 |
| --- | --- |
| `trial_id/name` | subflow/container instance |
| `condition` | scoped variable initial value |
| `repeat_count` | repeat policy |
| `iti_jitter_*` | wait component + random duration expression |
| `layout` | Screen 默认样式或迁移警告 |
| `steps + flow` | 合并为单一节点与边集合 |

## 5. Step 字段组

- 标识与内容：迁移至 component instance 的 `id`、`label` 和 `config.content`。
- 时间：迁移至标准 lifecycle policy。
- 媒体：迁移至 media component config 和 asset reference。
- 问卷与响应：迁移至 Screen UI tree、变量输出和 submit action。
- 外观：迁移至 UI element style；无法表达的 CSS 进入人工确认。
- 中断恢复：迁移至 execution policy。
- 分析窗口：迁移为 start/end 事件对或显式 window annotation。
- 操作员控制：迁移至 operator policy。

## 6. Flow 字段

| 旧类型 | 新节点 |
| --- | --- |
| `start/end` | core.start / core.end |
| `event` | 与引用 Step 合并后的 component instance |
| `condition` | logic.condition，显式 true/false control ports |
| `loop` | logic.loop，显式 body/exit control ports |
| `junction` | logic.merge |
| `note` | editor annotation，不进入执行图 |
| `group` | editor group；只有声明语义后才迁移为 container |

## 7. 迁移必须报告的异常

- Step 未放入 Flow；
- Event Node 引用缺失 Step；
- 同一 Step 被多个 Event Node 引用；
- 无法到达的可执行节点；
- 自定义 HTML/CSS/脚本；
- 外部问卷无法验证的字段；
- Trial 与 Theme 中重复且冲突的布局值；
- 缺失资源、无 checksum 的上传资源；
- 依赖隐式全局字符串变量的条件；
- 无法确定完成条件或恢复策略的节点。

## 8. 兼容原则

迁移器只读取旧模型。新编辑器不得写入 `blocks[].trials[].steps`。迁移成功后创建新协议 ID 或新主版本，并保留 `legacy.sourceProtocolId`、原始 JSON 哈希和迁移报告。
