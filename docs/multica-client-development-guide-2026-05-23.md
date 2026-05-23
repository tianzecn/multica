# Multica 客户端二次开发说明（Mac 本机）

日期：2026-05-23
适用机器：MacBook Pro
本机项目路径：`/Users/office/vscode/multica`
生产服务地址：<https://multica.mymanus.me>
本机开发地址：<http://localhost:3000>

## 结论

本机开发环境已经跑通，可以开始做客户端二次开发。

当前状态：

- Web 开发服务：`http://localhost:3000`
- 后端开发服务：`http://localhost:8080`
- Desktop 开发服务：`http://localhost:5173`
- 本机 PostgreSQL 容器端口：`127.0.0.1:15432 -> 5432`
- 本机 workspace：`abc`
- Desktop daemon：Running
- 可用本地 runtime：Claude、Codex、Hermes、Gemini、Cursor
- 已有智能体：`哈雷`，绑定 Codex runtime

这套环境是本机开发环境，不会直接操作服务器 `multica.mymanus.me` 的生产数据。

## 环境区分

### 生产环境

生产环境跑在服务器：

```text
https://multica.mymanus.me
```

生产环境用于真实使用、验收、演示和最终上线。

### 本机开发环境

本机开发环境跑在 Mac：

```text
http://localhost:3000
```

本机开发环境用于改代码、测试 UI、验证 Desktop、跑本地 agent，不要把它当成生产数据源。

## 本机端口配置

你 Mac 上已有一个本机 PostgreSQL 占用 `127.0.0.1:5432`，所以 Multica 本地开发数据库改用了 `15432`。

本机 `.env` 关键配置：

```env
POSTGRES_PORT=15432
DATABASE_URL=postgres://multica:multica@localhost:15432/multica?sslmode=disable
PORT=8080
FRONTEND_PORT=3000
FRONTEND_ORIGIN=http://localhost:3000
MULTICA_SERVER_URL=ws://localhost:8080/ws
MULTICA_APP_URL=http://localhost:3000
```

仓库里的 `docker-compose.yml` 已调整为支持 `POSTGRES_PORT`：

```yaml
ports:
  - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
```

## 启动本机 Web 开发环境

进入项目目录：

```bash
cd /Users/office/vscode/multica
```

启动本机开发服务：

```bash
make dev
```

启动成功后访问：

```text
http://localhost:3000
```

健康检查：

```bash
curl -fsS http://localhost:8080/readyz
```

期望返回：

```json
{"status":"ok","checks":{"db":"ok","migrations":"ok"}}
```

## 本机登录验证码

本机开发环境没有配置邮件服务，所以验证码不会真的发到 QQ 邮箱。

验证码会打印到后端日志，也可以从本地数据库查询：

```bash
docker compose exec -T postgres psql -U multica -d multica -c \
  "SELECT email, code, expires_at, used, created_at, attempts
   FROM verification_code
   WHERE email='403886@qq.com'
   ORDER BY created_at DESC
   LIMIT 5;"
```

如果页面提示需要等待，通常是验证码请求冷却，等约 60 秒后再点重新发送。

## 启动 Desktop 开发环境

保持 `make dev` 正在运行，然后另开一个终端：

```bash
cd /Users/office/vscode/multica
pnpm dev:desktop
```

Desktop 开发端口：

```text
http://localhost:5173
```

当前 Desktop 已成功连接本机后端：

```text
Server URL: http://localhost:8080
Profile: desktop-localhost-8080
State: Running
Workspaces: 1
```

## Daemon 状态

在 Desktop 里查看：

```text
设置 -> Daemon
```

当前正常状态应类似：

```text
State: Running
Server URL: http://localhost:8080
Workspaces: 1
```

Daemon 是本机 agent runtime 和 Multica 后端之间的桥。它正常运行后，Multica 才能把 issue 分配给本机 Codex、Claude、Hermes、Gemini、Cursor 等工具执行。

## 还需要配置什么

### 必须配置：代码仓库

在 Desktop 里进入：

```text
设置 -> 代码仓库
```

添加本项目路径：

```text
/Users/office/vscode/multica
```

这样智能体接到 issue 后，才知道应该在哪个代码目录里工作。

### 必须验证：最小测试 issue

进入：

```text
Issue -> 新建 issue
```

创建一个只读测试任务：

```text
请只读分析这个仓库的客户端结构，告诉我 Web 和 Desktop 分别从哪里启动，不要修改文件。
```

然后分配给 `哈雷`。

这个测试用于验证完整链路：

```text
Issue -> Agent -> Daemon -> Codex runtime -> 本机仓库
```

如果这个任务能跑通，说明客户端二次开发环境已经完整闭环。

## 推荐安装终端 CLI

当前 Desktop 开发构建自带 bundled CLI，所以 Desktop 可以运行 daemon。

但你的普通终端里还没有全局 `multica` 命令。为了后续方便在终端里查 issue、agent、runtime，建议安装：

```bash
brew install multica-ai/tap/multica
```

连接本机开发服务：

```bash
multica setup self-host \
  --server-url http://localhost:8080 \
  --app-url http://localhost:3000
```

如果要连接生产服务器：

```bash
multica setup self-host \
  --server-url https://multica.mymanus.me \
  --app-url https://multica.mymanus.me
```

日常二开建议优先连接本机开发服务，避免误操作生产数据。

## 客户端代码地图

常见二开入口：

```text
apps/web/         Next.js Web 外壳、路由和 Web 专属平台适配
apps/desktop/     Electron Desktop 外壳、窗口、桌面运行时配置
packages/views/   Web/Desktop 共享业务页面和组件
packages/core/    API client、React Query hooks、Zustand stores、业务逻辑
packages/ui/      基础 UI 组件
packages/tsconfig/共享 TypeScript 配置
```

改功能时优先判断影响范围：

- Web 和 Desktop 都要生效：优先改 `packages/views/` 和 `packages/core/`
- 只改 Web 壳层或 Next.js 路由：改 `apps/web/`
- 只改桌面窗口、菜单、运行时配置：改 `apps/desktop/`
- 只改基础按钮、输入框、弹窗等 UI 原子组件：改 `packages/ui/`

## 开发命令

启动完整本机 Web 开发环境：

```bash
make dev
```

只跑 Web：

```bash
pnpm dev:web
```

跑 Desktop：

```bash
pnpm dev:desktop
```

TypeScript 检查：

```bash
pnpm typecheck
```

前端测试：

```bash
pnpm test
```

Go 测试：

```bash
make test
```

完整检查：

```bash
make check
```

## 修改功能的推荐流程

1. 在本机创建或确认一个开发分支。
2. 启动 `make dev`。
3. 启动 `pnpm dev:desktop`。
4. 在 `packages/views/` 或 `packages/core/` 找到对应功能入口。
5. 小步修改，不做无关重构。
6. 在 Web `localhost:3000` 验证。
7. 在 Desktop `localhost:5173` 验证。
8. 跑 `pnpm typecheck` 和相关测试。
9. 确认后再部署到服务器。

## 部署到服务器

本机验证完成后，服务器更新流程：

```bash
ssh root@45.154.14.159

cd /opt/multica
git pull

docker compose \
  -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.build.yml \
  -f docker-compose.selfhost.server.yml \
  up -d --build
```

部署后验证：

```bash
curl -fsS https://multica.mymanus.me/readyz
```

期望返回：

```json
{"status":"ok","checks":{"db":"ok","migrations":"ok"}}
```

## 暂时不用配置的项目

以下可以后面再配：

- `API Token`：只有外部脚本或工具调用 Multica API 时需要。
- `Skill`：等固定能力沉淀下来后再加。
- `GitHub`：需要接 GitHub repo、PR、Webhook 时再配。
- `集成`、`实验室`、`通知`：二开早期可以先不管。
- SMTP/Resend：本机开发可以不配；生产环境后续建议配置。

## 常见问题

### localhost:3000 拒绝连接

说明前端服务没在跑。

处理：

```bash
cd /Users/office/vscode/multica
make dev
```

### 5432 端口被占用

你的 Mac 已经有本机 PostgreSQL 占用 `5432`。Multica 当前已改用 `15432`。

确认：

```bash
docker compose ps
```

应看到：

```text
127.0.0.1:15432->5432/tcp
```

### 登录收不到邮件

本机开发环境没有配置邮件服务，这是正常的。

直接查本地验证码：

```bash
docker compose exec -T postgres psql -U multica -d multica -c \
  "SELECT email, code, expires_at, used, created_at
   FROM verification_code
   ORDER BY created_at DESC
   LIMIT 5;"
```

### Desktop 里 Daemon 不在线

先确认本机后端还在：

```bash
curl -fsS http://localhost:8080/readyz
```

再看 Desktop：

```text
设置 -> Daemon
```

如果仍不在线，重启 Desktop 开发服务：

```bash
pnpm dev:desktop
```

### 智能体不执行 issue

优先检查四件事：

1. `设置 -> Daemon` 是否 Running。
2. `设置 -> 代码仓库` 是否添加了 `/Users/office/vscode/multica`。
3. `智能体 -> 哈雷` 是否绑定在线 runtime。
4. issue 是否已经分配给 `哈雷`。

## 下一步建议

先跑一个只读测试 issue。测试通过后，再开始真正的客户端二开。

第一个适合做的真实二开任务建议是：

```text
整理客户端页面结构，并在设置页或侧边栏加入一个轻量的新入口。
```

这类改动风险小，能快速熟悉 Web/Desktop 共享代码路径。
