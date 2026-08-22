# ADR-0001：Protocol Graph 是唯一可执行模型

状态：Accepted

决定：新协议只使用 `graph.nodes` 和 `graph.edges` 表达执行结构。组件配置保存在节点实例中，不再维护平行 Steps 数组。

原因：消除 Step 与 Flow 不一致、复制和删除需要双写、验证逻辑重复等问题。

影响：旧协议必须迁移；编辑器、运行时和导出器共同读取同一模型。
