# 科室协同办公系统（Dept Office System）

面向科室与中小团队的一体化轻量办公系统：人员层级管理、工作分派与进度跟踪、物料与资金账目、月度汇总报表、AI 总结与汇报 PPT、内置备份恢复。数据保存在本地 SQLite 单文件，不依赖外部数据库，一台服务器即可长期运行。

## 功能特性

- **人员与权限**：5 级角色层级（副经理/副总师/科长/副科长/科员），逐级授权，指定记账员，修改与派发全程留痕
- **工作过程管理**：工作登记、指派、改派、进度状态、下级工作跟踪、逾期/本周/停滞筛选
- **记账与报表**：物品领用发放、资金支出、挂账处理，月末自动汇总生成月度报表，支持导出
- **总结与汇报**：月度工作总结、经验库沉淀、AI 生成总结与汇报 PPT（可选配置大模型 Key）
- **首页工作台**：按角色聚合待办、账目概览、未读标注与审批
- **备份恢复**：一键备份（数据库+附件+配置打包）、恢复预览、失败回滚、自动轮转
- **多端访问**：浏览器即用，电脑、手机均可登录使用（手机端支持查看与审批）

## 技术栈

| 端 | 技术 |
|---|---|
| 后端 | Node.js 22+、Express、内置 `node:sqlite`、JWT |
| 前端 | Vue 3、TypeScript、Vite、Element Plus、ECharts |
| 部署 | Docker / Docker Compose（推荐），或单机 Node 直跑 |

## 快速开始

### 方式一：Docker（推荐，30 秒）

要求：装有 Docker 与 Docker Compose 的服务器（Linux / Windows / macOS 均可）。

```bash
cp .env.example .env        # 复制环境变量模板
# 编辑 .env：设置 JWT_SECRET（随机长串，>=32 位）
docker compose up -d --build
```

浏览器打开 `http://服务器IP:8080`，首次访问会自动进入"创建系统管理员"引导页，建完管理员即可逐级创建科室人员开始使用。

### 方式二：单机 Node

要求：Node.js 22+、npm。

```bash
cd backend
npm install
# 注入环境变量后启动（Windows PowerShell：$env:DISTRIBUTION_MODE='1'; $env:JWT_SECRET='...'; npm start）
DISTRIBUTION_MODE=1 JWT_SECRET=your-secret npm start
```

前端另开终端构建：

```bash
cd frontend
npm install
npm run build
```

用任意静态服务器托管 `frontend/dist`，并将 `/api` 反向代理到 `127.0.0.1:3000` 即可。

## 配置说明

| 变量 | 必填 | 说明 |
|---|---|---|
| `JWT_SECRET` | 是 | 登录令牌密钥，生产环境必须设置为随机长串 |
| `DISTRIBUTION_MODE` | 是 | `1` = 全新部署模式（0 账号，引导创建管理员），请保持 `1` |
| `MINIMAX_API_KEY` | 否 | MiniMax 大模型 Key，配置后可用 AI 总结/PPT；不配置其余功能不受影响 |

## 文档

- [部署手册.md](部署手册.md) —— Docker 与单机 Node 两条部署路径详解
- [用户手册.md](用户手册.md) —— 按角色的日常操作说明
- [功能清单.md](功能清单.md) —— 功能模块 × 角色权限对照

## 测试与构建

- 本项目核心功能经过完整开发验收（后端 152 项、前端 93 项自动化用例基线，含备份恢复、权限、记账、多端适配等专项）。
- 本公开仓库不含测试用例文件；CI 对前后端执行依赖安装与构建验证（`npm ci` + 类型检查 + 构建）。

## License

[MIT](LICENSE)
