# TODO — OpenMAIC → Dify 混合架构迁移

> 来源：`plan.md`（混合架构 + 单实例部署）
> 执行顺序：**Phase 0.4 → Phase 0.5 → Phase 0 → Phase 1 → Phase 2.A → Phase 3 →（GA 前）Phase 2.B**
> 硬门槛：Phase 0.5 的 5 个 spike 未全部通过前，**Phase 1 不得开工**

---

## Phase 0.4 — 起独立 Dify 实例（spike 载体，~半天）

**目标**：给 Phase 0.5 提供可调用的 Dify 实例，**不**进项目 docker-compose。

- [ ] 在 `~/dify-spike/` 路径下用官方 docker-compose 起一个单容器 Dify（**不要**放进 OpenMAIC 仓库）
- [ ] 初始化管理员账号
- [ ] 配置至少一个 LLM provider（推荐与项目当前主力 provider 一致的 key）
- [ ] 在 Dify Studio 手动建一个极简 workflow：`Start → LLM → End`
- [ ] 用 `POST /workflows/run` 调通 Service API
- [ ] 记录 `DIFY_API_URL` / `DIFY_API_KEY` / `DIFY_WORKFLOW_ID` 到临时 `.env.spike`（**不入库**）

**产出**：一个可 curl 调用的 Dify 实例 + 临时 env 文件

---

## Phase 0.5 — Dify 能力预验证（开工前硬门槛）

**目标**：实测 5 项关键假设，不通过则改方案。每个 spike 必须有明确 go/no-go 结论并写入报告。

### Spike 1 — Workflow publish API 机器触发
- [ ] 验证是否可用 REST/CLI 触发 `publish` 动作
- [ ] 或至少能通过 API 读出最新 published workflow id
- [ ] 记录通过/退化方案（人工 Publish + 手动更新 `DIFY_WORKFLOW_ID` env）

### Spike 2 — Iteration 节点 SSE 事件粒度
- [ ] 验证 streaming 响应里是否有 `iteration_next` / `iteration_completed` 事件
- [ ] 验证是否携带 `item_index`，能否拿到 per-scene 增量事件
- [ ] 记录退化方案（改显式 N 路并行 / 进度降级为 per-stage）

### Spike 3 — DSL canonicalize + schema hash 稳定性
- [ ] 同一 workflow 导出 DSL 3 次
- [ ] 写 canonicalizer（JSON 归一化 + 过滤 timestamps/uuids）
- [ ] 验证 canonicalized hash 是否完全一致
- [ ] 记录退化方案（放弃 `expectedSchemaHash`，只靠 Zod + DSL diff）

### Spike 4 — 长流程超时 benchmark
- [ ] 先用便宜模型（GLM-4.5-Flash / Gemini-2.5-Flash）跑 5-10 次，获得相对分布曲线
- [ ] 再用生产 model 跑 1-2 次作为绝对锚点校准
- [ ] 测 "20 outlines × 每个 2 分钟 LLM" 的 p95 总时长（门槛 ≤ 8 分钟）
- [ ] 验证 Dify worker 超时配置
- [ ] 记录每次 benchmark 的 token 消耗和 $ 成本
- [ ] 记录退化方案（拆多次 workflow 调用 / 流式续传）

### Spike 5 — PDF 解析保真度 + 大文件上限
- [ ] 挑一份含公式/表格/中文段落的教育场景 PDF
- [ ] 上传到 Dify dataset vs 走本地 `/api/parse-document`
- [ ] 对比文本抽取质量 + top-k 检索相关性（门槛：Dify ≥ 本地 80%）
- [ ] 测 Dify Datasets API 对 ≥ 50 MB 文件的行为
- [ ] 记录退化方案（plain text/markdown 走 Dify，富媒体 PDF 走本地 / 分片）

### Spike 总产出
- [ ] Provider 交集检查：列出项目当前 provider vs Dify 支持列表
- [ ] 生成 `ops/evaluation/dify-spike-report.md`（**没这份报告 Phase 1 不开工**）
- [ ] 每个 spike 的退化方案落实到 Phase 1 的代码计划里

---

## Phase 0 — 清理死代码（Phase 1 前置，~30 min）

**核心洞察**：前端入口 `POST /api/course/[courseId]/classrooms` 已有完整鉴权和 `courseId` 注入，不需要补鉴权。

### 删除
- [ ] 删除 `lib/generation/pipeline-runner.ts`（唯一真死代码，`createGenerationSession` / `runGenerationPipeline` 全仓零调用）
- [ ] 处理 `app/api/generate-classroom/route.ts` 的 POST handler：
  - [ ] grep 确认全仓无前端 `fetch('/api/generate-classroom'`
  - [ ] 若 MCP skill `skills/openmaic/references/generate-flow.md` 还在用这个 POST，先改 skill 文档指向 `/api/course/[courseId]/classrooms`
  - [ ] **删整个 POST handler**（保留 `[jobId]/route.ts` 的 GET handler）

### 改造
- [ ] 从 `lib/generation/generation-pipeline.ts:50` 移除 `createGenerationSession, runGenerationPipeline` 这一行 re-export
- [ ] **其余 40 行 barrel 保留**（被 4 个活文件依赖 `AgentInfo` / `parseJsonResponse` / `formatTeacherPersonaForPrompt`）

### 不做
- [ ] ~~不需要加鉴权~~（真实入口已有）
- [ ] ~~不需要改 `SessionToken` schema~~（不要求 orgId）
- [ ] ~~不需要改 `lib/server/auth/middleware.ts`~~（单租户无 orgId 概念）

### 验收
- [ ] `pnpm test && npx tsc --noEmit && pnpm lint` 全绿
- [ ] `grep -r "pipeline-runner\|runGenerationPipeline\|createGenerationSession" lib/ app/` 零匹配
- [ ] `grep -r "fetch.*'/api/generate-classroom'" app/` 零匹配（确认 POST handler 删除后无前端断链）
- [ ] `app/api/generate-classroom/[jobId]/route.ts` GET handler 仍可访问
- [ ] 通过 `/course/[courseId]` 页面走一次完整创建课程流程，行为完全不变

---

## Phase 1 — Dify 工作流骨架 + 生成后端对接（MVP）

**目标**：在 Dify 里复刻 `requirement → outline → scene content` 流水线，打通从 `classroom-generation.ts` 调用的链路。**不改**教师界面，**不新增**模块/实验节点。

### 1. 搭 Dify Workflow v1（种子版本）
- [ ] Start 节点：接收 `UserRequirements` 结构 + `courseId`
- [ ] LLM 节点：复用 `lib/generation/prompts/templates/requirements-to-outlines/{system,user}.md`，结构化输出 `SceneOutline[]`
- [ ] Iteration 节点（或 Phase 0.5 spike 2 决定的退化方案）：对每个 outline 生成 scene content
- [ ] End 节点：输出完整 JSON
- [ ] 发布为 v1
- [ ] 导出 DSL 到 `ops/dify-workflows/v1.yml`（版本化存 git 供 CI diff）

### 2. 定义 4 种 Scene Content Shape 的 Zod schema（**最重工作量项**，~800 行）
- [ ] `lib/server/dify-schema.ts` 定义 `slide` / `quiz` / `interactive` / `pbl` 四种 discriminated union
- [ ] 对齐 `lib/generation/scene-generator.ts:14-20` 的 `GeneratedSlideContent` / `GeneratedQuizContent` / `GeneratedInteractiveContent` / `GeneratedPBLContent`
- [ ] 覆盖 `lib/types/slides.ts`（829 行）里 9 个元素类型
- [ ] 覆盖 `lib/pbl/types.ts` 的嵌套结构
- [ ] 每个 scene 从 Dify 回来后必须先过 Zod，失败 fail-fast
- [ ] **CI 硬门禁**：`scripts/check-dify-schema-sync.ts`
  - [ ] 在 pre-commit 和 CI 运行
  - [ ] 若 `lib/types/slides.ts` / `lib/pbl/types.ts` / `lib/types/generation.ts` 有 diff 而 `dify-schema.ts` 没同步 → 直接 fail

### 3. 新增 `lib/server/dify-client.ts`（~180 行）
- [ ] 读 env：`DIFY_API_URL` / `DIFY_API_KEY` / `DIFY_WORKFLOW_ID`
- [ ] `runWorkflow(inputs, onProgress)`：`POST ${DIFY_API_URL}/workflows/run`，`response_mode: streaming`
- [ ] 解析 SSE events → 调 `GenerationCallbacks`（事件粒度按 Phase 0.5 spike 2 的结果适配）
- [ ] 审计日志：`{ workflowId, userId, inputsHash, status, durationMs, tokenUsage }`
- [ ] **Workflow id 只从 env 读**，函数签名不接受 id 参数
- [ ] TypeScript nominal type `PublishedWorkflowId`，编译级杜绝 draft id

### 4. 新增 `lib/server/generation-backend.ts`（~40 行）
- [ ] 单一决策函数 `pickGenerationBackend(): 'dify' | 'local'`
- [ ] 从 env `GENERATION_BACKEND` 读取（默认 `local`，安全出厂）
- [ ] **CI 硬检查**：除 `generation-backend.ts` 外不得出现 `process.env.GENERATION_BACKEND`

### 5. 改造 `lib/server/classroom-generation.ts`
- [ ] `generateClassroom()` 主循环里接入后端分流
- [ ] outline + scene content 阶段走 `pickGenerationBackend()`：
  - [ ] `'dify'` → 调 `dify-client.runWorkflow()`，拿校验过的 scene content
  - [ ] `'local'` → 保留现有 `generateSceneOutlinesFromRequirements` + `generateSceneContent` 路径
- [ ] **action 生成阶段无论走哪条都在本地**：`generateSceneActions()` + `createSceneWithActions()`
- [ ] 所有现有参数（`agentMode` / `enableWebSearch` / `pdfContent` 等）走本地路径时行为不变

### 6. 环境配置 + docker-compose 启动顺序
- [ ] `.env.example` 新增：
  ```
  GENERATION_BACKEND=local
  DIFY_API_URL=http://dify:5001/v1
  DIFY_API_KEY=app-xxxxxxxxxxxxxxxx
  DIFY_WORKFLOW_ID=wf-xxxxxxxxxxxxxxxx
  ```
- [ ] `docker-compose.yml` Next.js 服务 `depends_on: dify: { condition: service_healthy }`
- [ ] Dify 暴露 `/info` 健康探针
- [ ] 启动时 `GENERATION_BACKEND=dify` 但 env 变量不全 → fail-fast 拒绝启动
- [ ] env 齐全但 Dify 还没起来 → **不 fail-fast**，首次调用时 `dify-client.ts` 做健康探针，60 秒重试超时后返回 503 并 single-call fallback 到 `local`

### 7. 其他新增文件
- [ ] `lib/server/observability.ts`（~100 行）— metrics + tracing 封装
- [ ] `app/api/admin/dify-publish/route.ts` — 仅当 Phase 0.5 spike 1 通过时才建
- [ ] `tests/dify-pipeline.test.ts` — Dify 与本地 pipeline 对比测试
- [ ] `tests/dify-schema.test.ts` — 4 种 content shape Zod 单测
- [ ] `tests/backend-switching.test.ts` — `pickGenerationBackend` 行为单测
- [ ] `ops/evaluation/rubric.md` — 教学契合度评分 Rubric（Phase 1 开始前先落）

### Phase 1 验收
- [ ] `GENERATION_BACKEND=local` 回归：所有既有行为不变
- [ ] `GENERATION_BACKEND=dify` 走 Dify 路径，同一份需求跑 N=5 次：
  - [ ] Scene 数量差 ≤ 1
  - [ ] SceneType 分布 χ² test p > 0.05
  - [ ] 浏览器端全部可正常播放
- [ ] Phase 0.5 spike 的 5 项通过标准在 Phase 1 实际代码下复现
- [ ] Zod schema 覆盖 4 种 content shape 各至少一个单测
- [ ] CI schema sync guard 对 `slides.ts` / `pbl/types.ts` 改动能正确 fail
- [ ] **Smoke test 门禁**：10 个固定需求必须 ≥ 9 次成功（生成成功率 ≥ 90%）
- [ ] Dify Studio 里 Run 一次 workflow（固定需求 "高中生物 光合作用 45 分钟"），输出 JSON 通过服务端 Zod
- [ ] `tests/backend-switching.test.ts` 覆盖 `GENERATION_BACKEND=local/dify/unset` 三种情况
- [ ] `pnpm test && npx tsc --noEmit && pnpm lint` 全绿

---

## Phase 2.A — Dify RAG 接入，本地保留

**核心原则**：先加不减。`lib/rag/` + `DocumentChunk` + pgvector 保留不删。

**替换点**：`app/api/course/[courseId]/documents/route.ts`（POST 上传/GET 列表）+ `[docId]/route.ts`（DELETE）。**不是** `/api/parse-document`。

### 新增
- [ ] `lib/rag/dify-indexer.ts`：
  - [ ] 入参 `courseId + file + metadata`
  - [ ] 调 `POST ${DIFY_API_URL}/datasets/{dataset_id}/document/create-by-file`
  - [ ] dataset 不存在先调 `POST /datasets` 创建（命名 `openmaic-course-{courseId}`）
  - [ ] `description` 字段填入 `"【课程】${course.name}"`（Dify Studio 侧边栏辨认用）
- [ ] `lib/rag/dify-retriever.ts`：
  - [ ] 入参 `courseId + query + topK`
  - [ ] 调 `POST ${DIFY_API_URL}/datasets/{dataset_id}/retrieve`
  - [ ] 内部防御性检查：dataset 名必须匹配 `openmaic-course-${courseId}`

### 改造
- [ ] `lib/rag/index.ts` facade：
  - [ ] `indexDocument()` / `buildDocumentContext()` 按 `pickGenerationBackend()` 分流
  - [ ] 同时服务 `classroom-generation.ts` 和 `app/api/chat/route.ts`（后者零改动跟着生效）
- [ ] Phase 1 Workflow 加 Knowledge Retrieval 节点，`dataset_id` 由 Start 节点变量 `{{#start.courseId#}}` 动态指定
- [ ] `app/api/course/[courseId]/documents/route.ts` 通过 facade 分流
- [ ] `app/api/course/[courseId]/documents/[docId]/route.ts` DELETE 时同时删 Dify dataset 内对应 document
- [ ] 大文件处理：按 Phase 0.5 spike 5 结果，若 Dify 上限 < `documents/route.ts:67` 的 50 MB，在 `dify-indexer.ts` 里做分片或拒绝

### 权限
- [ ] `lib/server/permissions.ts` 的 `checkCourseAccess()` 在 API 入口拦截
- [ ] `dify-retriever.ts` 做第二道 dataset 名防御检查

### 双写观察期（可选，建议开启）
- [ ] 上传时同时写 Dify 和本地 pgvector（本地只写不查）
- [ ] 7 天内比对检索结果差异

### Phase 2.A 验收
- [ ] `tests/rag-e2e-test.ts` 改造后 Dify 版本跑通，top-k 相关性不回退
- [ ] **课程隔离测试**：courseId=A 上传含独特关键词 "zzzqqq" 的文档 → courseId=B 检索不到
- [ ] **大文件边界**：30 MB / 50 MB / 60 MB PDF 各测一次，记录 Dify 行为边界
- [ ] facade 双向覆盖：`classroom-generation.ts` 和 `app/api/chat/route.ts` 两条调用路径都正确分流

---

## Phase 3 — 开放画布 + 新增课程模块/实验设计节点

### 画布权限
- [ ] Dify Workflow 开放 draft 编辑权限给教师（Dify workspace 成员管理）

### 新节点
- [ ] **课程模块设计**：插在"需求"与"outline"之间
  - [ ] 输出 `Module[]`，作为 context 传给 outline 节点
- [ ] **实验设计**：插在 scene content 之后
  - [ ] 输出 `ExperimentActivity[]`

### Scene 协议扩展
- [ ] `lib/types/stage.ts` 的 `Scene` / `SceneContent` 加可选字段 `modules?: Module[]` / `experiments?: ExperimentActivity[]`
- [ ] `lib/server/classroom-generation.ts` 的 `generateClassroom()` 合并 Dify 返回的新字段
- [ ] `lib/server/dify-schema.ts` 同步扩展 Zod schema

### Multi-agent chat 联动（本次**不做**）
- [ ] ~~`lib/orchestration/director-graph.ts:54-77` 的 `OrchestratorState` 不扩展 `modules/experiments`~~
- [ ] Demo 期可接受：chat runtime 看不到教师设定的新字段
- [ ] GA 前再单独做（不属于本计划）

### 关键取舍
- [ ] 教师可改 prompt / 加减节点 / 调模型
- [ ] **不能改**最终输出节点的 content shape（会打破本地 `generateSceneActions()` 契约）

### 发布策略（Demo 期 2 层防护）
- [ ] **Layer 1**：`dify-client.ts` 的 Zod 校验（已在 Phase 1 落地）
- [ ] **Layer 2**：Workflow id 的 nominal type 隔离（已在 Phase 1 落地）
- [ ] 发布动作：教师手动在 Dify Studio 点 Publish → 手动更新 `DIFY_WORKFLOW_ID` env → 重启 OpenMAIC
- [ ] 若 Phase 0.5 spike 1 通过，可自动化；否则纯人工

### GA 前的完整 4 层防护（**本计划不包含**，记录为升级项）
- 上述 2 层
- \+ CI 对 `ops/dify-workflows/v*.yml` 的 DSL diff 检查
- \+ `expectedSchemaHash` 运行时比对
- \+ 账号 SSO + 审计日志关联
- \+ `POST /api/admin/dify-publish` 自动化发布流程

### Phase 3 验收
- [ ] 画布上加/删"课程模块设计"节点走 E2E 流程（`pnpm test:e2e`）
- [ ] **schema 漂移测试**：手动把 Dify End 节点输出结构改成不兼容 shape → `dify-client.ts` Zod 校验 fail-fast
- [ ] **发布策略测试**：构造调用试图传 draft workflow id → 类型系统编译失败 + 运行时防护拒绝
- [ ] **教学契合度门禁**：抽样 20 份生成结果，2 人独立 Rubric 打分均值 ≥ 80（分差 > 15 第三人仲裁）
- [ ] 不达标则回退 workflow 版本

---

## Phase 2.B — 本地 RAG 下线（**Demo 期不执行**，推迟到 GA 前）

**执行时机门槛**：
- [ ] 日活跃请求 ≥ 50 次
- [ ] Dify 路径连续 2 周无 Zod 校验失败 + 无手动降级
- [ ] `tests/rag-e2e-test.ts` 已全部迁移到 Dify 路径并稳定通过
- [ ] Phase 3 的教师画布已上线且教师实际在用

**删除顺序**（独立清理任务，分多个 commit）：
- [ ] 删 `lib/rag/indexer.ts` / `embeddings.ts` / `chunker.ts`
- [ ] 保留 `retriever.ts` 接口但内部只走 Dify
- [ ] 改 `lib/rag/types.ts` 去掉 `DocumentChunk` 引用
- [ ] Prisma migrate：drop `DocumentChunk` 表 + `Document.chunks` relation
- [ ] **⚠️ 不要 drop pgvector extension**（Dify 自己的知识库也依赖）
- [ ] 每一步单独跑 `pnpm test && npx tsc --noEmit`

---

## 观测性与告警（贯穿 Phase 1-3）

### Metrics（OpenTelemetry 或 prom-client）
- [ ] `dify_workflow_duration_ms` (histogram, labels: `workflow_id`, `status`)
- [ ] `dify_workflow_failures_total` (counter, labels: `reason`: `zod_error` / `timeout` / `dify_error` / `http_error`)
- [ ] `dify_token_usage_total` (counter, labels: `model`, `direction`)
- [ ] `rag_retrieval_duration_ms` (histogram)
- [ ] `rag_retrieval_backend` (counter, labels: `backend`)

### Tracing
- [ ] `classroom-generation.ts` 的 `generateClassroom()` 入口开 span
- [ ] `dify-client.ts` 的 `runWorkflow()` 创建子 span，记录 `workflow_id` / `http_status` / `retry_count`
- [ ] Zod 校验失败时 span 打 error tag

### Alerts
- [ ] Dify 健康探针：每 30 秒 GET `${DIFY_API_URL}/info`，连续 3 次失败告警
- [ ] `dify_workflow_failures_total` 5 分钟速率 > 2 次/分钟告警
- [ ] 成功率滚动窗口低于 85% 告警（比 90% 门槛低 5 个百分点预警）

---

## Prompt 模板回流策略

- [ ] **Phase 1 开始后** `lib/generation/prompts/templates/` 变成只读
- [ ] 本地修改必须手动同步到 Dify 画布，但**优先在 Dify 里改**
- [ ] 接受漂移：demo 阶段 Dify 和 local 的 prompt 可能不一致，local 只求能跑
- [ ] 可选：每月一次人工 review Dify 画布 prompt 是否要 backport 回 git
- [ ] Phase 2.B（GA 前）可考虑把 `templates/` 目录一起删

---

## 验收门槛汇总（硬指标）

### 指标 1：生成成功率 ≥ 90%
- [ ] 定义：`/api/generate-classroom` 返回 Scene[] + Zod 通过 + 浏览器端可播放无 runtime 报错
- [ ] 窗口：最近 100 次滚动
- [ ] 数据源：`lib/server/observability.ts` + 前端 playback 初始化事件
- [ ] 门禁：Phase 1 smoke test 10 个固定需求 ≥ 9 次成功

### 指标 2：教学契合度 ≥ 80%
- [ ] 定义：需求匹配 / 学情适配 / 内容准确 / 结构合理 四维等权平均
- [ ] 样本：Phase 1 结束时抽样 20 份（覆盖不同学科/学段）
- [ ] 评分：2 人独立，分差 > 15 第三人仲裁
- [ ] Rubric 位置：`ops/evaluation/rubric.md`
- [ ] 门禁：Phase 3 开放画布前重跑一次，不达标回退 workflow 版本

---

## 关键技术风险追踪

| 风险 | 缓解落地位置 | Owner |
|---|---|---|
| Dify 发布 API 不可机器触发 | Phase 0.5 spike 1 退化方案 | — |
| Iteration 事件粒度不够 | Phase 0.5 spike 2 退化方案 | — |
| DSL schema hash 不稳定 | Phase 0.5 spike 3 退化方案 | — |
| 长流程超时 | Phase 0.5 spike 4 退化方案 | — |
| Dify 版本升级破坏 DSL 兼容性 | 升级前 dev 验证 + 多版本 `ops/dify-workflows/v*.yml` + 升级窗口切 local | — |
| Prompt 双源真相 | "Prompt 模板回流策略"：接受漂移 | — |
| 并发生成冲突 | `classroom-job-store` 加"同 course 最多一个 running job"幂等检查 | Phase 1 |
| 大文件超 Dify 上限 | Phase 2.A dify-indexer 分片或拒绝 | Phase 2.A |
| Scene content shape 漂移 | Zod fail-fast + CI sync guard + nominal type | Phase 1 |
| Dify 内部依赖故障 | 健康探针 + `GENERATION_BACKEND=local` 一键切换 | Phase 1 |
| Dify provider 支持集是子集 | **Phase 0.5 前置** provider 交集检查 | Phase 0.5 |
| 教师误操作破坏 Workflow | draft/published 分离 + Dify Studio 版本回滚 | Phase 3 |

---

## 回滚方案（Demo 单实例）

- [ ] **全局回滚**：`GENERATION_BACKEND=local` + 重启（一个 env 变量）
- [ ] **Dify 故障**：健康探针失败 → 告警 → 手动切 env → 重启
- [ ] **数据层无需回滚**：`DocumentChunk` 表和本地 RAG 代码全程保留
- [ ] **Workflow 回滚**：Dify Studio 把 `DIFY_WORKFLOW_ID` 指向历史 published 版本
