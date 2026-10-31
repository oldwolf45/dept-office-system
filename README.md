# 科室协同办公系统（Dept Office System）

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3.x-42b883?logo=vue.js&logoColor=white" alt="Vue 3">
  <img src="https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License">
  <img src="https://img.shields.io/github/languages/code-size/oldwolf45/dept-office-system" alt="Code Size">
</p>

> 面向科室与中小团队的一体化轻量办公系统：人员层级管理、工作分派与进度跟踪、物料与资金账目、月度汇总报表、AI 总结与汇报 PPT、内置备份恢复。数据保存在本地 SQLite 单文件，不依赖外部数据库，一台服务器即可长期运行。

---

## ✨ 功能特性

| 模块 | 说明 |
|---|---|
| 👥 **人员与权限** | 5 级角色层级（副经理/副总师/科长/副科长/科员），逐级授权，指定记账员，操作全程留痕 |
| 📋 **工作过程管理** | 工作登记、指派、改派、进度状态、下级工作跟踪、逾期/本周/停滞筛选、工作交接 |
| 💰 **记账与报表** | 物品领用发放、资金支出、挂账处理，月末自动汇总生成月度报表，支持导出 |
| 📊 **数据统计** | 首页工作台按角色聚合待办、账目概览、ECharts 可视化图表 |
| 📝 **总结与经验库** | 月度工作总结、经验库沉淀、AI 生成总结与汇报 PPT（可选） |
| 💾 **备份恢复** | 一键备份（数据库+附件+配置打包）、恢复预览、失败回滚、自动轮转 |
| 📱 **多端适配** | 响应式布局，电脑、手机浏览器即用 |
| 🔐 **安全** | JWT 登录、强制首次改密、软删除、权限中间件、操作日志 |

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3、TypeScript、Vite、Pinia、Element Plus、ECharts、Tailwind CSS |
| 后端 | Node.js 22+、Express、内置 `node:sqlite`、JWT、Multer |
| 部署 | Docker / Docker Compose（推荐），或单机 Node 直跑 |
| 数据 | SQLite 单文件（`data/app.db`），附件本地存储 |

## 🚀 快速开始

### 方式一：Docker（推荐，一条命令）

要求：装有 Docker 与 Docker Compose 的服务器（Linux / Windows / macOS 均可）。

```bash
# 克隆仓库
git clone https://github.com/oldwolf45/dept-office-system.git
cd dept-office-system

# 配置环境变量
cp .env.example .env
# 编辑 .env，设置 JWT_SECRET（随机长串，>=32 位）

# 启动（首次构建需几分钟，之后秒级启动）
docker compose up -d --build
```

浏览器打开 `http://服务器IP:8080`，首次访问自动进入"创建系统管理员"引导页。

> 首次启动会自动生成临时自签证书并启用 HTTPS（跳转 `https://服务器IP:8443`）。公网正式使用请按 [HTTPS.md](HTTPS.md) 替换为自己的证书。

### 方式二：单机 Node

要求：Node.js 22+、npm。

```bash
# 后端
cd backend
npm install
DISTRIBUTION_MODE=1 JWT_SECRET=your-secret npm start

# 前端（另开终端）
cd frontend
npm install
npm run build
```

用任意静态服务器托管 `frontend/dist`，并将 `/api` 反向代理到 `127.0.0.1:3000`。

## ⚙️ 配置说明

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `JWT_SECRET` | 是 | 登录令牌密钥，生产环境必须设置为随机长串 |
| `DISTRIBUTION_MODE` | 是 | `1` = 全新部署模式（0 账号，引导创建管理员）|
| `MINIMAX_API_KEY` | 否 | MiniMax 大模型 Key，配置后可用 AI 总结/PPT |

## 📚 文档

- [部署手册.md](部署手册.md) — Docker 与单机 Node 两条部署路径详解
- [HTTPS.md](HTTPS.md) — HTTPS 自签证书配置指南（公网部署必读）
- [用户手册.md](用户手册.md) — 按角色的日常操作说明
- [功能清单.md](功能清单.md) — 功能模块 × 角色权限对照表

## ✅ 质量保证

- GitHub Actions CI：每次提交自动做后端语法检查 + 前端类型检查与构建验证
- 前端构建验证（vue-tsc 类型检查 + Vite 生产构建）
- 已完成 Docker 真机部署验证（阿里云轻量服务器）
- 文档齐备：部署手册 / 用户手册 / 功能清单

## 📂 目录结构

```
.
├── backend/                # Node.js (Express) 后端
│   ├── src/
│   │   ├── controllers/    # 控制器层
│   │   ├── models/         # 数据模型
│   │   ├── routes/         # 路由定义
│   │   ├── services/       # 业务逻辑
│   │   ├── middleware/     # 中间件
│   │   └── utils/          # 工具函数
│   ├── package.json
│   └── Dockerfile
├── frontend/               # Vue 3 前端
│   ├── src/
│   │   ├── views/          # 页面组件
│   │   ├── components/     # 通用组件
│   │   ├── api/            # API 封装
│   │   ├── store/          # Pinia 状态
│   │   ├── router/         # 路由
│   │   └── utils/          # 工具函数
│   ├── package.json
│   └── Dockerfile
├── .github/workflows/      # CI 配置
├── docker-compose.yml      # Docker 一键启动
├── .env.example            # 环境变量模板
├── 部署手册.md / 用户手册.md / 功能清单.md
└── README.md
```

## 🤝 开源协议

[MIT License](LICENSE)

---

<p align="center">
  如果觉得有用，点个 ⭐ Star 支持一下吧！
</p>


