# Multica 自托管部署说明（multica.mymanus.me）

日期：2026-05-23
访问地址：<https://multica.mymanus.me>

## 结论

Multica 服务已经部署成功，并完成了公网访问、HTTPS、后端健康检查、前端登录页、API 配置、WebSocket 路由、数据库迁移和首次用户/工作区初始化验证。

当前实例运行在服务器 `45.154.14.159` 上，不在本机运行。你的管理员邮箱 `403886@qq.com` 已被加入注册白名单，数据库中已存在该用户，并已创建工作区 `abc`。

## 今天对话与决策总结

1. 一开始目标是分析 Multica 项目如何部署和二次开发，重点是数据安全。
2. 部署方式最终确定为服务器自托管，不放在本机。
3. 服务器 IP 确认为 `45.154.14.159`，源码已放在服务器 `/opt/multica`。
4. 你说明所有二级域名都已解析到这台服务器，因此选用了 `multica.mymanus.me` 作为 Multica 访问域名。
5. 管理员邮箱使用 `403886@qq.com`。
6. 服务器已有 Dokploy/Traefik，占用了 80/443，因此 Multica 没有直接暴露自己的 3000/8080 端口，而是接入 Dokploy 的 Traefik 反向代理。
7. 邮件服务暂未配置，所以登录验证码目前从后端日志获取；后续建议配置 SMTP 或 Resend。
8. 注册已关闭为白名单模式，仅允许 `403886@qq.com` 注册/登录。

## 服务器环境

- 服务器：`45.154.14.159`
- 系统：Ubuntu 22.04 LTS
- 配置：8 vCPU、约 15 GiB 内存、约 155 GiB 磁盘
- 反向代理：Dokploy 自带 Traefik
- 关键端口占用：
  - `80/443`：Dokploy Traefik
  - `3000`：Dokploy
  - `8080`：已有飞书中间件

因此 Multica 使用本机回环端口：

- 前端：`127.0.0.1:13000 -> 3000`
- 后端：`127.0.0.1:18080 -> 8080`
- PostgreSQL：仅 Docker 内部访问，不公开到公网

## 部署架构

公网请求路径：

```text
用户浏览器
  -> https://multica.mymanus.me
  -> Dokploy Traefik 80/443
  -> multica-frontend:3000 或 multica-backend:8080
```

路由规则：

- `/`、`/login` 等页面请求转发到前端 `multica-frontend:3000`
- `/api/*`、`/auth/*`、`/health`、`/readyz`、`/uploads/*` 转发到后端 `multica-backend:8080`
- `/ws` 转发到后端 WebSocket

Docker 服务：

- `multica-postgres-1`：PostgreSQL + pgvector
- `multica-backend-1`：Go 后端
- `multica-frontend-1`：Next.js 前端

## 服务器关键文件

源码目录：

```bash
/opt/multica
```

服务器专用 Compose 覆盖文件：

```bash
/opt/multica/docker-compose.selfhost.server.yml
```

环境变量文件：

```bash
/opt/multica/.env
```

Traefik 动态配置：

```bash
/etc/dokploy/traefik/dynamic/multica.yml
```

Docker 数据卷：

```bash
multica_pgdata
multica_backend_uploads
```

## 关键配置

以下是可公开记录的关键配置，密钥和数据库密码不写入本文档。

```env
APP_ENV=production
PORT=18080
FRONTEND_PORT=13000
FRONTEND_ORIGIN=https://multica.mymanus.me
CORS_ALLOWED_ORIGINS=https://multica.mymanus.me
MULTICA_SERVER_URL=wss://multica.mymanus.me/ws
MULTICA_APP_URL=https://multica.mymanus.me
MULTICA_PUBLIC_URL=https://multica.mymanus.me
LOCAL_UPLOAD_DIR=/app/data/uploads
LOCAL_UPLOAD_BASE_URL=https://multica.mymanus.me
ALLOW_SIGNUP=false
ALLOWED_EMAILS=403886@qq.com
ANALYTICS_DISABLED=true
```

说明：

- `ALLOW_SIGNUP=false` 表示关闭公开注册。
- `ALLOWED_EMAILS=403886@qq.com` 表示只允许该邮箱注册/登录。
- 未配置 `RESEND_API_KEY` 或 `SMTP_HOST` 时，验证码不会发邮件，会打印在后端日志里。
- 生产环境不要启用固定验证码。

## 部署与重启命令

进入服务器源码目录：

```bash
cd /opt/multica
```

从源码构建并启动：

```bash
docker compose \
  -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.build.yml \
  -f docker-compose.selfhost.server.yml \
  up -d --build
```

查看容器状态：

```bash
docker compose \
  -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.build.yml \
  -f docker-compose.selfhost.server.yml \
  ps
```

只重启后端：

```bash
docker compose \
  -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.build.yml \
  -f docker-compose.selfhost.server.yml \
  restart backend
```

查看后端日志：

```bash
docker compose \
  -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.build.yml \
  -f docker-compose.selfhost.server.yml \
  logs -f backend
```

查看前端日志：

```bash
docker compose \
  -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.build.yml \
  -f docker-compose.selfhost.server.yml \
  logs -f frontend
```

## 健康检查

后端就绪检查：

```bash
curl -fsS https://multica.mymanus.me/readyz
```

期望结果：

```json
{"status":"ok","checks":{"db":"ok","migrations":"ok"}}
```

前端登录页：

```bash
curl -I https://multica.mymanus.me/login
```

API 配置：

```bash
curl -fsS https://multica.mymanus.me/api/config
```

当前返回重点：

```json
{"cdn_domain":"multica.mymanus.me","allow_signup":false}
```

HTTPS 证书：

```bash
openssl s_client -connect multica.mymanus.me:443 -servername multica.mymanus.me </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

当前证书信息：

```text
subject=CN = multica.mymanus.me
issuer=C = US, O = Let's Encrypt, CN = R12
notBefore=May 23 03:02:44 2026 GMT
notAfter=Aug 21 03:02:43 2026 GMT
```

## 登录与验证码

当前允许登录邮箱：

```text
403886@qq.com
```

由于邮件服务暂未配置，验证码从后端日志获取：

```bash
cd /opt/multica

docker compose \
  -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.build.yml \
  -f docker-compose.selfhost.server.yml \
  logs backend | grep -i "verification"
```

如果页面提示 `please wait before requesting another code`，通常是验证码请求冷却，需要等待约 60 秒后再点。

## 当前验证结果

已验证通过：

- 容器全部运行：Postgres、Backend、Frontend
- Postgres 容器健康状态为 `healthy`
- `https://multica.mymanus.me/login` 返回 HTTP 200
- `https://multica.mymanus.me/readyz` 返回数据库和迁移均 OK
- `https://multica.mymanus.me/api/config` 返回 `allow_signup:false`
- HTTPS 证书为 Let's Encrypt，域名匹配 `multica.mymanus.me`
- WebSocket `/ws` 已正确路由到后端
- 数据库中已有用户 `403886@qq.com`
- 数据库中已有工作区 `abc`

## 备份建议

备份数据库：

```bash
cd /opt/multica

docker compose \
  -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.build.yml \
  -f docker-compose.selfhost.server.yml \
  exec -T postgres pg_dump -U multica -d multica > multica-backup-$(date +%F).sql
```

备份上传文件卷：

```bash
docker run --rm \
  -v multica_backend_uploads:/data \
  -v "$PWD":/backup \
  ubuntu tar czf /backup/multica-uploads-$(date +%F).tar.gz -C /data .
```

建议后续把数据库和上传文件做每日自动备份，并把备份同步到服务器外部位置。

## 二次开发与上线流程

代码结构：

- `server/`：Go 后端
- `apps/web/`：Next.js Web 前端
- `apps/desktop/`：Electron 桌面端
- `packages/core/`：共享业务逻辑、API client、状态管理
- `packages/ui/`：基础 UI 组件
- `packages/views/`：Web/Desktop 共享业务页面和组件

常用本地开发命令：

```bash
make dev
pnpm typecheck
pnpm test
make test
make check
```

服务器更新部署建议流程：

```bash
cd /opt/multica
git pull

docker compose \
  -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.build.yml \
  -f docker-compose.selfhost.server.yml \
  up -d --build
```

如果只是改前端/后端代码，仍建议完整执行上面的 `up -d --build`，让镜像从当前源码重新构建。

## CLI / 本机 daemon 连接

如果本机还没有安装 CLI：

```bash
brew install multica-ai/tap/multica
```

连接这台自托管服务器：

```bash
multica setup self-host \
  --server-url https://multica.mymanus.me \
  --app-url https://multica.mymanus.me
```

Desktop 客户端如果要连接自托管实例，可以配置 `~/.multica/desktop.json`：

```json
{
  "schemaVersion": 1,
  "apiUrl": "https://multica.mymanus.me"
}
```

## 后续建议

1. 配置 SMTP 或 Resend，让验证码真正发到邮箱。
2. 配置数据库和上传文件的定时备份。
3. 二次开发尽量走 Git 提交，再在服务器 `git pull` 后构建，避免直接在服务器手改源码。
4. 如果后续开放给更多成员，继续使用 `ALLOWED_EMAILS` 白名单控制注册范围。
5. 如果要做客户端功能改造，优先改 `packages/views/` 和 `packages/core/`，这样 Web 与 Desktop 更容易复用。
