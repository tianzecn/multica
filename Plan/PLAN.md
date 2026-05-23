# Multica 频道协作调度器计划

## Summary
把当前“多 AI 派发 + 简单串行关键词”升级为正式的频道协作调度器。每条用户消息先生成可见 `dispatch plan`，再按 `single / parallel / serial / roundtable` 执行。默认频道主动档：未 @AI 时也由 planner 从频道 AI 成员中自动选择全部相关 AI；高危动作仍走审批。

## Key Changes
- 新增结构化模型：
  - `channel_dispatch_plan`：记录触发消息、模式、状态、置信度、planner 来源、理由、成本/耗时统计。
  - `channel_dispatch_step`：记录每个 AI 步骤、依赖关系、状态、指令、关联 `channel_agent_run`。
  - `channel_dispatch_feedback`：记录用户切换模式、跳过、重试、追加 AI 等修正，用于后续评估。
- Planner 策略：
  - 规则先行，低置信度用服务端小模型输出 JSON plan，1 秒超时后规则降级。
  - 低置信度仍执行，但计划卡显示原因和置信度。
  - planner 隐私策略与当前 AI/模型策略一致。
- 调度行为：
  - `single`：一个 AI 直接响应。
  - `parallel`：所有相关 AI 并行响应。
  - `serial`：后续 AI 等依赖 AI 真实发言后再启动。
  - `roundtable`：先多人并行，再由显式指定或自动选择的 AI 汇总。
  - 离线或无运行时 AI 跳过并说明；不设硬人数/成本上限，但计划卡显示实际参与和消耗。
- UI/UX：
  - Web/Desktop 复用 shared views：消息流内显示计划卡，右侧显示当前协作摘要。
  - Mobile 显示紧凑内联卡，详情和控制放到底部面板。
  - 完成后计划卡自动折叠；关键节点通知，普通中间发言只算普通未读。
  - 计划卡支持取消、跳过、重试、追加 AI，以及轻量模式切换按钮；不做任意 DAG 编辑。
- API/CLI：
  - 新增 plan/step 查询与控制 API：list/get/cancel/retry/skip/add-agent/change-mode。
  - CLI 新增完整控制能力：`multica channel plan list/get/cancel/retry/skip/add-agent`。
  - WS 新增或复用结构化事件刷新 plan/step 状态，保持 Web/Desktop/Mobile/CLI 一致。

## Test Plan
- Planner 单测覆盖中文多话术：先后顺序、反驳、总结、分别分析、@all、无 @ 自动选人、低置信度降级。
- E2E 覆盖截图场景：产品经理先发言，技术负责人基于真实发言总结；最小变更工程师不会提前空等。
- 运行态测试：并行、串行、roundtable、失败暂停、跳过、重试、追加 AI、模式切换。
- 安全测试：自动选中 AI 遇到高危动作必须生成审批卡，不得绕过。
- 上下文隔离测试：后续步骤只读取原始消息、计划、依赖发言和计划相关窗口，不读取整频道历史。
- 全端验收：Web/Desktop/Mobile/CLI 能看到同一 plan、step、状态、失败和控制结果。
- 兼容测试：旧 `channel_agent_run` 不批量迁移；读取时以 legacy plan 方式展示，新消息走正式 plan。

## Assumptions
- 新频道默认主动档；频道设置可切换安静/标准/主动。
- 自动选人只从频道 AI 成员中选择，相关性优先看 agent 名称、描述、指令、skills、频道说明和用户消息。
- 不设硬成本上限，但计划卡必须显示参与 AI 数、运行任务数、耗时和实际用量。
- 多条用户消息各自生成独立 plan，不自动合并。
- 复杂话题分叉时，planner 只建议拆会话，不自动拆。
