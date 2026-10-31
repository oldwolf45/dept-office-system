# 更新日志

本项目的所有重要变更都会记录在此文件中。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

## [1.0.0] - 2026-10-29

首个公开版本发布。

### 新增

- 人员与权限：5 级角色层级（副经理 / 副总师 / 科长 / 副科长 / 科员），逐级授权，指定记账员，操作全程留痕
- 工作过程管理：工作登记、指派、改派、进度状态、下级工作跟踪、逾期 / 本周 / 停滞筛选、工作交接
- 记账与报表：物品领用发放、资金支出、挂账处理，月末自动汇总生成月度报表，支持导出
- 数据统计：首页工作台按角色聚合待办与账目概览，ECharts 可视化
- 总结与经验库：月度工作总结、经验库沉淀、AI 生成总结与汇报 PPT（可选，MiniMax）
- 备份恢复：一键备份（数据库 + 附件 + 配置打包）、恢复预览、失败回滚、自动轮转
- 多端适配：响应式布局，电脑、手机浏览器即用
- 安全：JWT 登录、强制首次改密、软删除、权限中间件、操作日志
- Docker / Docker Compose 一键部署

### 工程

- 前端：Vue 3、TypeScript、Vite、Pinia、Element Plus、ECharts、Tailwind CSS
- 后端：Node.js 22+、Express、内置 node:sqlite、JWT、Multer
- 数据：SQLite 单文件（data/app.db），附件本地存储
- GitHub Actions CI：后端语法检查 + 前端类型检查与构建验证
