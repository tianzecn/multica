# Multica 本地目录工作能力方案

## Summary
目标是在 Multica 中默认开放一套完整的本地目录工作能力，让 agent 能在 daemon 所在电脑的真实目录中工作，而不只依赖远端 Git repo + per-task worktree。

核心产品形态为三种模式并存：

- **Local Git Worktree**：本地 Git repo 默认模式，从本机 `.git` 创建 per-task worktree，保留并行隔离。
- **Live / Fixed Directory**：P4、SVN、无 VCS、大型资产目录等直接在已有目录工作，用路径锁保证一次一个任务。
- **Mounted Folder Resource**：非主目录资源作为附加本地目录暴露给 agent，用于资料、素材、vault、Downloads 等。

计划文档落点：创建 `docs/plans/local-directories.md`，内容采用“产品 + 工程 Spec”，按可拆 PR 粒度组织。

## Key Changes
- 新增 `LocalResource` 数据模型，作为本地目录能力的核心抽象，而不是扩展 `workspace.repos` 或只加 Agent 字段。
- `LocalResource` 绑定 `workspace_id + daemon_id/device + owner_id`，服务端保存完整绝对路径；同一目录跨 workspace 使用时需要分别授权。
- 默认 workspace 共享、默认读写；注册目录时做一次显式授权，之后任务不再逐次确认。
- 资源管理权限：资源拥有者和 workspace admin 可共享、绑定、编辑；所有成员可看完整路径并使用已共享资源。
- Desktop 负责用系统 folder picker 注册本地目录；Web 只展示、引用、复制路径和查看状态。
- Project 可绑定多个本地目录资源，并显式指定一个 Primary；Project 目录优先级最高。
- 工作目录优先级：`Project Primary LocalResource > Agent default LocalResource > Issue/Run LocalResource`；Issue/Run 级目录仅在没有 Project 本地目录时生效。
- Chat、Autopilot、Quick Create、Issue 都支持本地目录上下文；Chat 中资源为会话级持续上下文。
- Agent picker 对无法访问所选本地资源的 agent 灰显并说明原因。
- 设备离线或目录锁占用时，任务进入等待状态，不默认超时，用户可手动取消。

## Implementation Plan
- PR 1：新增数据模型和 API
  - 创建 `local_resource` 表，字段覆盖 label、absolute_path、daemon_id、device_name、mode、vcs_type、access、primary/default 元数据、init_script_path、cleanup_script_path、indexing_enabled、health 状态。
  - Project/Chat/Autopilot/Quick Create 增加引用本地资源的能力。
  - 目录注册必须是绝对路径；Desktop 可创建新目录；空目录默认执行 `git init`。
  - 后端校验资源归属、共享权限、Project Primary 唯一性。

- PR 2：Desktop 与 UI
  - 增加 “My Computer / Local Resources” 面板：按电脑展示本地目录、健康状态、锁状态、索引状态、共享状态。
  - Project Resource 面板支持添加多个本地目录、设置 Primary、查看完整路径。
  - Task/Issue properties 显示实际工作目录、锁等待状态、VCS 状态摘要，并提供 Desktop Finder 打开和复制路径。
  - Web 端不可选择新本地路径，只能引用已由 Desktop/daemon 注册的资源。

- PR 3：Daemon 执行模式
  - Local Git Worktree：从本地 Git repo 创建 per-task worktree；只自动准备 Primary repo，其他目录作为路径清单暴露。
  - Fixed/Live Directory：直接以目录为 `Cwd`，使用 daemon 内存锁 + 本地锁文件保护并发。
  - Fixed/Live 模式下 `multica repo checkout` 返回明确错误。
  - init/cleanup script 配置在 LocalResource 上，以绝对路径执行；任务环境传入 `MULTICA_WORK_DIR`、`MULTICA_TASK_ID`、`MULTICA_RESOURCE_ID`、`MULTICA_VCS_TYPE` 等变量。
  - 不默认 cleanup；脚本仅在用户配置时运行。

- PR 4：运行时上下文与安全提示
  - 不覆盖用户已有 `CLAUDE.md` / `AGENTS.md` / runtime 配置。
  - Multica 运行时说明写入旁路文件，例如 `.multica/runtime.md` 和 `.multica/project/resources.json`。
  - Agent brief 中列出 Primary 目录、附加目录别名、VCS 类型、写入授权、锁等待信息和禁止 checkout 的规则。
  - P4/SVN/none 第一版只注入 VCS-aware guidance，不内置 p4/svn 操作封装。

- PR 5：本地索引
  - 索引按目录手动启用，默认关闭。
  - 索引只存本机 daemon，本机以 watcher + 退化轮询刷新。
  - 第一版索引文本文件内容，以及二进制文件的路径、文件名、大小、mtime。
  - 提供本地 CLI 搜索命令供 agent 使用；My Computer 面板内置搜索 UI。

## Test Plan
- API：本地资源创建、共享、权限、Project Primary 唯一性、跨 workspace 独立授权、不可访问 agent 禁用逻辑。
- Desktop：folder picker 注册目录、创建新目录、空目录默认 `git init`、Finder 打开、复制路径。
- Daemon：本地 Git worktree 创建、Live Directory Cwd、路径锁等待、锁文件恢复、设备离线等待、checkout 禁用。
- Scripts：init/cleanup 成功、失败、超时、环境变量传入、任务结束后默认不清理。
- Multi-entry：Issue、Quick Create、Chat、Autopilot 都能引用本地资源，并在不可访问时进入正确状态。
- Index：手动启用、文本索引、二进制元数据、watcher 更新、CLI search、本机-only 存储。
- Regression：现有远端 Git repo + `multica repo checkout` 流程不受影响。

## Assumptions
- 功能默认开放，不做 feature flag。
- 默认读写、workspace 共享、所有成员可见完整路径。
- 目录注册时一次性授权，后续自动任务无需逐次确认。
- 三平台支持：macOS、Windows、Linux。
- `docs/plans/local-directories.md` 是最终计划文件路径；当前 Plan Mode 下不写文件，切换到执行模式后再落盘。
