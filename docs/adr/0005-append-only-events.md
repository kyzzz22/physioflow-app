# ADR-0005：原始事件使用 append-only Event Envelope

状态：Accepted

决定：运行事实以版本化 Event Envelope 追加写入 JSONL；CSV、响应表和分析窗口都是派生投影。

原因：保留原始证据，允许升级分析逻辑后重新生成结果。

影响：恢复、修正和排除都通过新增事件表达，不修改历史事件。
