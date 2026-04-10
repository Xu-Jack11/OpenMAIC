# TODO

---

# OpenMAIC → Dify 迁移可行性评估

> 本节来自 `/Users/jack/.claude/plans/refactored-discovering-papert.md`，经过两轮 subagent 评审迭代。
> 架构决策：混合架构（Dify 做生成层 + 单实例部署），OpenMAIC 保留 playback/whiteboard/multi-agent chat runtime。

## Context

**现状**：OpenMAIC 的 classroom 生成**真实前端入口**是 `POST /api/course/[courseId]/classrooms`（见 `app/(authenticated)/course/[courseId]/page.tsx:76` 调用点），该 route 已经有 `authenticate()` + `authenticateCourse('TEACHER')` 校验且会把 `courseId` 注入到 `GenerateClassroomInput`，然后调用 `lib/server/classroom-generation.ts` 的 `generateClassroom()`（538 行）。该函数**直接**串联 `generateSceneOutlinesFromRequirements` + `generateSceneContent` + `generateSceneActions`。

`app/api/generate-classroom/route.ts` 的 POST handler **没有任何前端调用方**（grep 全仓只有自引用 + MCP skill 文档），等同死代码；但 `app/api/generate-classroom/[jobId]/route.ts` 的 GET handler 仍被用于轮询 job 状态，**不能删**。

`lib/generation/pipeline-runner.ts`（91 行）的两个导出符号 `createGenerationSession` / `runGenerationPipeline` 在生产路径无任何调用——这才是**唯一的真死代码**。而 `lib/generation/generation-pipeline.ts`（50 行）**不是死代码**，它是一个 barrel re-export，被 `app/api/generate/scene-actions/route.ts:17`、`scene-outlines-stream/route.ts:24-25`、`scene-content/route.ts:15-16`、`lib/hooks/use-scene-generator.ts:9` 共 4 个**活文件**依赖（导入 `AgentInfo` / `parseJsonResponse` / `formatTeacherPersonaForPrompt` 等）。只应从该 barrel 的第 50 行移除 `createGenerationSession, runGenerationPipeline` 那一行 re-export，文件本身保留。

`AICallFn` / `GenerationResult` / `GenerationCallbacks` 定义在 `lib/generation/pipeline-types.ts:56-68`，**不在** `pipeline-runner.ts`——删 runner 不影响类型系统。

多 agent 编排在 `lib/orchestration/director-graph.ts`（LangGraph StateGraph）。RAG 在 `lib/rag/` 实现（pgvector，~1.3K 行），被 `classroom-generation.ts:30` 和 `app/api/chat/route.ts:23` 共用同一个 `buildDocumentContext`。

**诉求**：
1. 让教师/教研（非技术人员）能够可视化地自定义生成流程；典型场景是前期加"课程模块设计"、后期加"实验设计"。
2. 项目需要 RAG。

**用户已确认（硬前提，不再讨论）**：
- 最终使用者是教师/教研（非技术人员）→ 需要可视化 DAG 画布
- 愿意把 RAG 切换到 Dify 原生知识库
- **部署模式**：**单租户整栈部署**——每个机构独立部署一整套 (OpenMAIC + Postgres + Dify)。这意味着一个 OpenMAIC 实例只服务一个机构，**不需要** Organization 领域模型、不需要 orgId 路由、不需要机构注册表。数据隔离靠"不同进程/不同机器"天然达成。
- **项目阶段**：demo 阶段，只有 1 个目标机构；无历史数据迁移成本。
- **运维**：项目作者本人一个人。
- **验收门槛**：生成成功率 ≥ 90%、教学契合度 ≥ 80%（统计口径见 [验收门槛](#验收门槛可测口径) 一节）。

**结论（TL;DR）**：**全量迁移不可行，但推荐**混合架构**单实例部署**。Dify 承载"可被教师编排的内容生成层"（+ 知识库），OpenMAIC 保留"无法搬离的运行时层"（playback engine、whiteboard actions、multi-agent chat runtime）。整体代码复杂度远低于任何多实例/多租户方案。

**动工前硬门槛**：必须先完成 Phase 0.5 Dify 能力预验证——如果 spike 里有任何一项失败，整个方案要重新评估。

---

## 三层分层：什么能走，什么不能走

基于 `lib/orchestration/`(~2.9K 行)、`lib/generation/`(~2.9K 行)、`lib/rag/`(~1.3K 行)、`lib/action/` + `lib/playback/`(~1.5K 行) 的摸底：

### A 层：可以迁到 Dify（真正用得上画布的部分）

| 组件 | 当前位置 | 迁移方式 |
|---|---|---|
| 需求解析 | `lib/generation/requirement-analyzer.ts:1-130` | LLM 节点 + 结构化 JSON 输出 |
| 课程模块设计（新） | — | 新增 LLM 节点，画布上插在 outline 之前 |
| Outline 生成 | `lib/generation/outline-generator.ts:1-194` | LLM 节点 |
| Scene 内容生成 | `lib/generation/scene-generator.ts:1-1292` 中的 content 部分 | **Iteration 节点** 或显式 N 路并行（见 Phase 0.5 spike 2）|
| 实验设计（新） | — | 新增 LLM 节点，插在 scene 生成之后 |
| 课程讲义/延伸阅读 | `app/api/generate/handout`, `extended-reading` 等路由 | 独立 Workflow，按需触发 |
| RAG 检索注入 | `lib/rag/retriever.ts`, `context-builder.ts` | Dify 原生 Knowledge Retrieval 节点 |

### B 层：必须留在 OpenMAIC（Dify 无法表达）

| 组件 | 当前位置 | 为什么留 |
|---|---|---|
| Action 执行 | `lib/action/engine.ts:1-524` | 15 种自定义 action（`wb_draw_text`, `spotlight`, `wb_draw_chart` 等），直接操作 `lib/store/canvas.ts` |
| Playback 引擎 | `lib/playback/engine.ts:1-737` | 状态机 `idle/playing/paused/live`，支持中途暂停/恢复、TTS 播放、用户打断。Dify 工作流不可中断式恢复 |
| 白板渲染 | `lib/prosemirror/`, canvas store | 依赖浏览器 SVG + PPTist 数据模型 |
| Multi-agent 实时讨论 | `lib/orchestration/director-graph.ts:1-554` | LangGraph director → agent → director 循环 + 自定义 SSE 事件（`agent_start`, `text_delta`, `action`, `cue_user`） |
| Scene 协议 / Action 词表 | `lib/types/stage.ts`, `lib/types/action.ts:166-181` | 贯穿全栈的领域类型 |

### C 层：需要适配层

| 组件 | 处理方式 |
|---|---|
| **Scene Actions 生成** | **保留在 OpenMAIC**。Dify 输出 scene content 后，OpenMAIC 本地调 `generateSceneActions()` 继续走。理由：action 词表耦合太深，放 Dify 里会造成双写同步噩梦。但要为此**定义 4 种 content shape 的严格 Zod schema**（见 Phase 1 关键动作）。 |
| **Scene content 格式转换** | Dify Workflow 输出 JSON → Zod 校验 → `SceneContent` 类型 |
| **SSE 流对接** | Dify Service API 的 streaming 格式 ≠ 当前 `/api/generate-classroom` 的进度事件。`dify-client.ts` 做适配器层 |

---

## 推荐架构：混合（Dify 生成 + OpenMAIC 运行），单实例部署

```
┌────────────── 单机构部署边界 ───────────────────────────┐
│                                                        │
│  ┌─────────── Dify ──────────┐                         │
│  │ Studio (教师可视化画布)   │                         │
│  │ Workflow (草稿 / 发布)    │                         │
│  │ Knowledge Base            │                         │
│  │  ├ openmaic-course-X      │                         │
│  │  ├ openmaic-course-Y      │                         │
│  │  └ openmaic-course-Z      │                         │
│  └──────────┬────────────────┘                         │
│             │ HTTP (local network)                     │
│             │ env: DIFY_API_URL / DIFY_API_KEY         │
│             │      DIFY_WORKFLOW_ID                    │
│             ▼                                          │
│  ┌──────── OpenMAIC Next.js Server ─────────────────┐  │
│  │                                                   │  │
│  │  /api/generate-classroom (authenticated)          │  │
│  │   ├ classroom-generation.ts: generateClassroom()  │  │
│  │   ├ pickGenerationBackend() → 'dify' | 'local'    │  │
│  │   ├ 若 dify → dify-client.runWorkflow()           │  │
│  │   ├ 本地 generateSceneActions() → Scene[]         │  │
│  │   └ persistClassroom + 推 SSE                     │  │
│  │                                                   │  │
│  │  /api/chat (保持不动)                             │  │
│  │   └ LangGraph director-graph (本地运行)           │  │
│  │                                                   │  │
│  │  lib/rag/index.ts (facade)                        │  │
│  │   └ Dify Datasets API 或 本地 pgvector (兜底)     │  │
│  │                                                   │  │
│  │  lib/action + lib/playback (保持不动)             │  │
│  │   └ 浏览器端播放 Scene.actions[]                  │  │
│  └───────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

**拓扑说明**：
- **单栈部署**：一套 OpenMAIC + 一套 Dify + 一套 Postgres，同一部署单元内。
- **无路由层**：不需要 `dify-registry.ts`、不需要 `OrgDifyBinding` 表、不需要 allowlist/SSRF 防护、不需要密钥加密。Dify 连接走三个 env 变量：`DIFY_API_URL` / `DIFY_API_KEY` / `DIFY_WORKFLOW_ID`。
- **课程级隔离仍然需要**：同一机构内多门课的 RAG 知识库必须隔离，靠 Dify dataset 命名 `openmaic-course-{courseId}` + `checkCourseAccess()` 权限校验。
- **发布/草稿分离**：教师改的是 Dify draft workflow，线上 `/api/generate-classroom` 只调 env 里 `DIFY_WORKFLOW_ID` 指向的 published 版本。发布是一个**显式一次性动作**（见"权限与发布策略"），Phase 0.5 会验证这个动作是否能自动化。

**为什么这样分**：
1. 画布的价值只在"教师能自己拖拽编排的部分"体现——那就是生成链路。
2. 运行时（playback + whiteboard + 实时 chat）没人会去画布上改，留在 OpenMAIC 里避免无意义的迁移。
3. 多 agent chat 在本地 LangGraph，意味着"上课中的实时讨论"仍用现有的 director-graph；Dify 只负责"备课时的内容生成"。用户原话的两个例子（课程模块设计、实验设计）都落在生成阶段。
4. 单实例部署让整个方案的代码复杂度降到最低：无路由、无机构建模、无多租户权限。

---

## Phase 0.4：起一个独立的 Dify 实例（spike 的载体）

Phase 0.5 的 4 个 spike 都需要一个可以调用的 Dify 实例，但整个项目的 docker-compose 集成在 Phase 1 才做。两者会形成循环依赖。解法是先起一个**独立的**单容器 Dify（不进项目 compose），只给 spike 用。

**关键动作**：
- [ ] `docker run` 官方 Dify 镜像（或用 Dify 官方 docker-compose，起在 `~/dify-spike/` 路径下，**不要**放进 OpenMAIC 仓库）
- [ ] 初始化管理员账号，配置至少一个 LLM provider（推荐用和项目当前主力 provider 一致的 key）
- [ ] 手动建一个极简 workflow（Start → LLM → End），验证能通过 Service API `POST /workflows/run` 调通
- [ ] 把 `DIFY_API_URL` / `DIFY_API_KEY` / `DIFY_WORKFLOW_ID` 记在一个临时 `.env.spike`（不入库）

这一步的工作量是半天；Phase 0.5 的所有 spike 都基于这个实例跑。Phase 1 的 OpenMAIC docker compose 起 Dify 时可以用 `dify-spike` 导出的 workflow DSL 作为种子。

---

## Phase 0.5：Dify 能力预验证（开工前硬门槛）

计划中若干关键能力假设必须**先实测**，不通过则改方案。每个 spike 都有明确的 go/no-go 判断。

| Spike | 要验证什么 | 通过标准 | 不通过的退化方案 |
|---|---|---|---|
| **1. Workflow publish API 是否可机器触发** | Dify 是否开放 REST/CLI 让服务端自动执行 "publish" 并拉取新 published workflow id | 能用 HTTP 调用触发发布；或至少能用 API 列出 workflow 的历史版本并读出最新 published id | 若纯 UI：`POST /api/admin/dify-publish` 降级为"人工在 Studio 点 Publish + 服务端 poll 历史版本 API 更新 env var `DIFY_WORKFLOW_ID`"；不能自动 reload，需要在后台提醒一下 |
| **2. Iteration 节点 SSE 事件粒度** | Dify streaming 响应里，`iteration_next` / `iteration_completed` 事件是否存在且携带 `item_index` | 能拿到 per-scene 的增量事件，前端进度条可做到 "X/N 场景" | 若只有 iteration 整体的 start/finish：Phase 1 把 Iteration 拆成**显式 N 路并行分支**（N=10，够 demo），或把进度语义降级为 per-stage（只显示 "outline → content → actions"） |
| **3. DSL 导出稳定性 + schema hash 方案** | Dify workflow 导出的 DSL 文件里有多少非功能性字段（timestamps、internal ids、uuids）会每次变；用 canonicalizer（JSON 归一化 + 过滤已知易变字段）后能否算出稳定 hash | 同一个 workflow 连续导出 3 次，canonicalized hash 完全一致 | 若不稳定：放弃 `expectedSchemaHash` 字段，改为只依赖 `dify-client.ts` 的 Zod 校验 + CI 对 DSL 文件做字段级 diff 检查 |
| **4. 长流程超时 benchmark** | Iteration 节点对 "20 outlines × 每个 2 分钟 LLM" 的实测 p95 总时长；Dify 默认 workflow 最大运行时长配置；单节点 LLM 超时 | p95 ≤ 8 分钟；且 Dify worker 能配置相应的超时 | 若超时：Phase 1 要么拆成多次 workflow 调用（每次 ≤ 5 scene），要么把 Iteration 改为流式续传（每收到一个 scene 就立即 emit 回 OpenMAIC） |
| **5. PDF 解析保真度对比** | 同一份含公式/表格/中文段落的教育场景 PDF，分别上传到 Dify dataset 和走 OpenMAIC 现有 `/api/parse-document` 链路，对比文本抽取质量和 top-k 检索相关性；同时验证 Dify Datasets API 对 50 MB 以上文件的行为 | Dify 抽取质量 ≥ 本地链路的 80%（按关键字召回率简单度量）；单文件上限 ≥ 50 MB | 若质量显著回退：Phase 2.A 只把"新上传的 plain text/markdown 文档"切到 Dify，富媒体 PDF 仍走本地；若上限 < 50 MB：`dify-indexer.ts` 里做分片或拒绝 |

**关于 spike 4 的 LLM 配额**：真实跑 "20 × 2 分钟 × N 次" 的成本不低。执行策略：
1. 先用便宜模型（如 GLM-4.5-Flash、Gemini-2.5-Flash）跑 5-10 次，获得**相对分布曲线**（并发度、超时表现、事件流行为）
2. 再用实际生产 model 跑 1-2 次作为**绝对锚点**校准
3. 记录每次 benchmark 的 token 消耗和 $ 成本在 spike 报告里

Spike 产出：`ops/evaluation/dify-spike-report.md`，记录每条的实测结果和采纳的退化方案（如果有）。

**没有这份报告，Phase 1 不开工。**

### Phase 0.5 TODO
- [ ] Spike 1: Workflow publish API 机器触发可行性
- [ ] Spike 2: Iteration 节点 SSE 事件粒度
- [ ] Spike 3: DSL canonicalize + schema hash 稳定性
- [ ] Spike 4: 20 outlines × 2min benchmark（便宜 model + 生产 model 校准）
- [ ] Spike 5: PDF 解析保真度对比 + 大文件上限
- [ ] Provider 交集检查：列出项目当前 provider vs Dify 支持列表
- [ ] 生成 `ops/evaluation/dify-spike-report.md`

---

## 分阶段迁移路径

### Phase 0：清理死代码（Phase 1 的前置，工作量 ~30 分钟）

这一步的核心洞察：**现有代码已经对了**。前端入口 `POST /api/course/[courseId]/classrooms` 已经有完整鉴权和 `courseId` 注入——不需要"补鉴权"或"补 courseId 传递"。Phase 0 的工作缩到只有"清理三个无人用的残留"。

**关键动作**：

- [ ] **删除 `lib/generation/pipeline-runner.ts`**：两个导出符号（`createGenerationSession`、`runGenerationPipeline`）在全仓零调用。`AICallFn` / `GenerationResult` / `GenerationCallbacks` 类型都在 `pipeline-types.ts`，不受影响。
- [ ] **从 `lib/generation/generation-pipeline.ts:50` 移除 `createGenerationSession, runGenerationPipeline` 那一行 re-export**，保留其余 40 行 barrel。4 个生产文件依赖其他符号不变。
- [ ] **处理 `app/api/generate-classroom/route.ts` 的 POST handler**：
   - grep 确认全仓无前端 `fetch('/api/generate-classroom'`；唯一调用方是 `skills/openmaic/references/generate-flow.md`（MCP skill）
   - 选项 A（推荐）：**删整个 POST handler**（保留 `[jobId]/route.ts` 的 GET handler，那个轮询 URL 还在用）
   - 选项 B：POST handler 返回 `410 Gone`，并在注释里说明已被 `/api/course/[courseId]/classrooms` 替代
   - 如果 MCP skill 仍在用这个 POST：先把 skill 文档改成调 `/api/course/[courseId]/classrooms`，再执行选项 A
- [ ] **grep 验证**：`grep -r "pipeline-runner\|runGenerationPipeline\|createGenerationSession" lib/ app/` 应零匹配；`grep -r "'/api/generate-classroom'" app/` 应只剩 `[jobId]` 路径的自引用

**Phase 0 不需要做的**：
- ❌ 不需要加鉴权（真实入口已有）
- ❌ 不需要改 `SessionToken` schema（不要求 orgId）
- ❌ 不需要改 `lib/server/auth/middleware.ts`（单租户无 orgId 概念）

**验收**：`pnpm test && npx tsc --noEmit && pnpm lint` 全绿；手动走一次完整创建课程流程（通过 `/course/[courseId]` 页面），行为不变；grep 验证项全部通过。

---

### Phase 1：Dify 工作流骨架 + 生成后端对接（MVP）

**目标**：在 Dify 里复刻 "requirement → outline → scene content" 流水线，打通从 `classroom-generation.ts` 调用的链路。**不改**教师界面，**不新增**模块/实验节点。

**关键动作**：

**1. 搭 Dify Workflow v1（种子版本）**：
- [ ] Start 节点：接收 `UserRequirements` 结构 + `courseId`（RAG 检索用）
- [ ] LLM 节点：复用 `lib/generation/prompts/templates/requirements-to-outlines/system.md` + `user.md`，结构化输出 `SceneOutline[]`
- [ ] Iteration 节点（或 Phase 0.5 spike 2 决定的退化方案）：对每个 outline 生成 scene content
- [ ] End 节点：输出完整 JSON；**schema 由服务端的 Zod 来守护**，Dify 侧无原生锁定机制
- [ ] 发布为 v1；导出 DSL 到 `ops/dify-workflows/v1.yml`（版本化存 git，不是为了回滚 Dify，是为了 CI diff 检查）

**2. 定义 4 种 Scene Content Shape 的 Zod schema**（硬门禁，**最重工作量项**）：
- [ ] `lib/server/dify-schema.ts`：分别为 `slide` / `quiz` / `interactive` / `pbl` 四种 `SceneType` 定义 Zod discriminated union
- [ ] 对应 `lib/generation/scene-generator.ts` 里 `GeneratedSlideContent` / `GeneratedQuizContent` / `GeneratedInteractiveContent` / `GeneratedPBLContent`（见 `scene-generator.ts:14-20`）
- **工作量现实估计**：`GeneratedSlideContent.elements: PPTElement[]` 指向 `lib/types/slides.ts`（829 行）里 9 个元素类型的 discriminated union；`GeneratedPBLContent.projectConfig` 指向 `lib/pbl/types.ts` 的嵌套结构。合理估算 Zod schema **~800 行**（不是 150），并且要跟 `slides.ts` / `pbl/types.ts` / `generation.ts` 保持双向同步
- [ ] **CI 硬门禁**：新增 `scripts/check-dify-schema-sync.ts`，在 pre-commit 和 CI 里运行——如果 `lib/types/slides.ts` / `lib/pbl/types.ts` / `lib/types/generation.ts` 的 diff 未同时伴随 `lib/server/dify-schema.ts` 的 diff，**直接 fail**。这是唯一能防止 "TS interface 改了 schema 没跟上→Dify 输出过校验但运行时炸" 的手段
- [ ] 每个 scene 从 Dify 回来后必须先通过 Zod 校验，失败 fail-fast
- 这一步是 Phase 1 进入 Phase 2 的门禁——没 schema，就没法把 Dify 输出安全地喂给本地 `generateSceneActions()`

**3. 新增 `lib/server/dify-client.ts`**（~180 行）：
- [ ] 读 env：`DIFY_API_URL` / `DIFY_API_KEY` / `DIFY_WORKFLOW_ID`
- [ ] `runWorkflow(inputs, onProgress)`：`POST ${DIFY_API_URL}/workflows/run`，`response_mode: streaming`
- [ ] 解析 SSE events（事件粒度按 Phase 0.5 spike 2 的结果适配）→ 调 `GenerationCallbacks`
- [ ] 每次调用写审计日志：`{ workflowId, userId, inputsHash, status, durationMs, tokenUsage }`
- [ ] Workflow id 只从 env 读，**不接受函数参数传入**——用强类型杜绝调用方传 draft id 的可能

**4. 新增 `lib/server/generation-backend.ts`**（单一后端决策函数，~40 行）：
```ts
export function pickGenerationBackend(): 'dify' | 'local' {
  // 单租户部署下不需要 orgId 参数
  const flag = process.env.GENERATION_BACKEND ?? 'local' // 默认 local，安全出厂
  return flag === 'dify' ? 'dify' : 'local'
}
```
- [ ] **CI 硬检查**：除 `generation-backend.ts` 外不得出现 `process.env.GENERATION_BACKEND` 的读取

**5. 改造 `lib/server/classroom-generation.ts`**（真实生产路径）：
- [ ] 在 `generateClassroom()` 主循环里接入后端分流
- [ ] outline 阶段 + scene content 阶段走 `pickGenerationBackend()`：
  - `'dify'` → 调 `dify-client.runWorkflow()`，拿到校验过的 scene content
  - `'local'` → 保留现有 `generateSceneOutlinesFromRequirements` + `generateSceneContent` 路径
- [ ] **action 生成阶段无论走哪条都在本地**：`generateSceneActions()` + `createSceneWithActions()`
- [ ] 所有现有的参数（`agentMode`, `enableWebSearch`, `pdfContent` 等）走本地路径时行为不变

**6. 环境配置 + docker-compose 启动顺序**：
- [ ] `.env.example` 新增：
  ```
  GENERATION_BACKEND=local               # 或 dify
  DIFY_API_URL=http://dify:5001/v1        # docker-compose 内网地址
  DIFY_API_KEY=app-xxxxxxxxxxxxxxxx
  DIFY_WORKFLOW_ID=wf-xxxxxxxxxxxxxxxx    # 指向 published workflow
  ```
- [ ] `docker-compose.yml` 里 Next.js 服务 `depends_on: dify: { condition: service_healthy }`；Dify 需要暴露 `/info` 健康探针
- [ ] 启动时 `GENERATION_BACKEND=dify` 但 env 变量不全则直接 fail-fast 拒绝启动
- [ ] 启动时 env 齐全但 Dify 还没起来：**不 fail-fast**，而是**首次实际调用时**由 `dify-client.ts` 做健康探针，探针失败最多重试 60 秒，超时后返回 503 且自动降级到 `local`（single-call fallback，不改 env）

**Phase 1 验收**：
- [ ] `GENERATION_BACKEND=local` 回归测试：所有既有行为不变
- [ ] `GENERATION_BACKEND=dify` 走 Dify 路径：同一份需求跑 N=5 次，两种 backend：
  - Scene 数量差 **≤ 1**（不要求严格相等，LLM 有随机性）
  - SceneType 分布的 χ² test p > 0.05（分布无显著差异）
  - 浏览器端全部可正常播放
- [ ] Phase 0.5 spike 的 5 项通过标准在 Phase 1 实际代码下复现
- [ ] Zod schema 校验覆盖 4 种 content shape，每种至少一个单测
- [ ] CI schema sync guard 对 `slides.ts` / `pbl/types.ts` 的改动能正确 fail

---

### Phase 2：RAG 迁到 Dify 原生知识库

**隔离模型**：
- 单实例部署意味着**不需要机构隔离**，只需要**课程级隔离**
- Dify 内每门 course 一个 dataset，命名 `openmaic-course-{courseId}`
- workflow 的 Knowledge Retrieval 节点通过变量动态指定 dataset id
- 权限层：`lib/server/permissions.ts` 的 `checkCourseAccess()` 保证 "用户 U 能访问 course C" → 才允许对该 dataset 的检索

**核心原则：先加不减**。本地 `lib/rag/` + `DocumentChunk` + pgvector **保留不删**，直到 Dify RAG 证明稳定（见 Phase 2.B 门槛）。原因：
- `DocumentChunk` 在 13 个文件里有硬依赖，急着删 CI 会先炸
- `tests/rag-e2e-test.ts` 必须先迁移到 Dify 路径
- 本地 RAG 充当 `GENERATION_BACKEND=local` 时的完整兜底，删了就没退路

**替换点定位**（重要）：真正要替换的 API 入口是
- `app/api/course/[courseId]/documents/route.ts`（POST = 上传索引；GET = 列文档）
- `app/api/course/[courseId]/documents/[docId]/route.ts`（DELETE + 可能的 reindex）
- **不是** `/api/parse-document`——那个只负责文本解析预览，不触发索引

#### Phase 2.A：Dify RAG 接入，本地保留

**关键动作**：

- [ ] **新增** `lib/rag/dify-indexer.ts`：入参 `courseId + file + metadata`，调 `POST ${DIFY_API_URL}/datasets/{dataset_id}/document/create-by-file`；dataset 不存在先调 `POST /datasets` 创建
- [ ] **新增** `lib/rag/dify-retriever.ts`：入参 `courseId + query + topK`，调 `POST ${DIFY_API_URL}/datasets/{dataset_id}/retrieve`
- [ ] **改造** `lib/rag/index.ts` 的 facade：
   - `indexDocument()` / `buildDocumentContext()` 根据 `pickGenerationBackend()` 分流到 Dify 或本地
   - **同时服务 `classroom-generation.ts` 和 `app/api/chat/route.ts`**，后者不需要额外改动就能跟着生效（两个调用方都走同一个 `buildDocumentContext`）
- [ ] 在 Phase 1 的 Workflow 里加 Knowledge Retrieval 节点，dataset_id 由 Start 节点变量 `{{#start.courseId#}}` 动态指定
- [ ] **课程级权限校验**：`lib/server/permissions.ts` 的 `checkCourseAccess()` 在 API 入口拦截；`dify-retriever.ts` 内部再做一次 "dataset 名必须匹配 `openmaic-course-${courseId}`" 的防御性检查
- [ ] **大文件处理**：Phase 0.5 spike 5 已经验证 Dify 单文件上限 + PDF 解析保真度，Phase 2.A 按 spike 结果执行：若 Dify 上限 < `documents/route.ts:67` 的 50 MB，则 `dify-indexer.ts` 里做分片或拒绝
- [ ] **dataset display name UX**：Dify Studio 里教师看到的 dataset id 是 `openmaic-course-ckl3h2f8g0000` 这样的 cuid，无法认出是哪门课。解决：调 Dify Datasets API 创建 dataset 时 `description` 字段填入真实课程名 `"【课程】${course.name}"`，教师在 Studio 侧边栏的 dataset 列表就能靠 description 辨认
- [ ] **双写观察期（可选，建议开启）**：上传时同时走 Dify 和本地 pgvector 写入（本地只写不查），7 天内比对检索结果差异；有问题立刻切回

**Phase 2.A 验收**：
- [ ] 同一份文档上传后，Dify 检索 top-k 的相关性相对本地不回退（用 `tests/rag-e2e-test.ts` 改造后的 Dify 版本测）
- [ ] 课程隔离测试：courseId=A 上传含独特关键词 "zzzqqq" 的文档 → courseId=B 检索 → **检索不到**
- [ ] 大文件边界：30 MB / 50 MB / 60 MB PDF 各测一次，记录 Dify 的行为边界

#### Phase 2.B：本地 RAG 下线（**demo 期不执行**，推迟到 GA 前）

demo 阶段的流量根本不足以支撑"连续 4 周无降级"这种门槛的统计意义（每天可能就几次请求）。本地 RAG 在 demo 期**永久保留作为兜底**，不做任何删除动作。

Phase 2.B 真正的执行时机：GA（对外开放）前的清理任务。届时的门槛应该是：
- 日活跃请求 ≥ 50 次，Dify 路径连续 2 周无 Zod 校验失败 + 无手动降级
- `tests/rag-e2e-test.ts` 已全部迁移到 Dify 路径并稳定通过
- Phase 3 的教师画布已上线且教师实际在用

**当 GA 前真要执行时的删除顺序**（独立清理任务，分多个 commit）：
1. 删 `lib/rag/` 里本地实现相关的 `indexer.ts` / `embeddings.ts` / `chunker.ts`；保留 `retriever.ts` 接口但内部只走 Dify
2. 改 `lib/rag/types.ts` 去掉 `DocumentChunk` 引用
3. Prisma migrate：drop `DocumentChunk` 表、`Document.chunks` relation
4. **⚠️ 不要 drop pgvector extension**：Dify 自己的知识库也依赖 pgvector（同一个 Postgres 还是不同 Postgres 实例是部署时的决定）。单方面 drop extension 会炸 Dify。这一步要么不做，要么先确认 Dify 不在同一个 Postgres
5. 每一步单独跑 `pnpm test && npx tsc --noEmit`

**降级路径（demo 阶段实际会用的）**：`GENERATION_BACKEND=local` 一键回到本地 RAG，无数据丢失。

---

### Phase 3：开放画布给教师 + 新增课程模块/实验设计节点

**关键动作**：

- [ ] Dify Workflow 开放 draft 编辑权限给教师（Dify 原生 workspace 成员管理）
- [ ] 在画布上加两个新 LLM 节点：
   - **课程模块设计**：插在 "需求" 与 "outline" 之间，输出 `Module[]`，作为 context 传给 outline 节点
   - **实验设计**：插在 scene content 之后，输出 `ExperimentActivity[]`
- [ ] **扩展 Scene 协议**：
   - `lib/types/stage.ts` 的 `Scene` 或 `SceneContent` 加可选字段 `modules?: Module[]`, `experiments?: ExperimentActivity[]`
   - `lib/server/classroom-generation.ts` 的 `generateClassroom()` 把 Dify 返回的新字段合并进 `Scene`
   - `dify-schema.ts` 的 Zod schema 同步扩展
- **Multi-agent chat 层的联动**（评审发现的重要盲点）：
   - `lib/orchestration/director-graph.ts:54-77` 的 `OrchestratorState` annotation 没有 `modules/experiments`
   - 如果希望 chat 时 agent 能感知"教师设定的课程模块"，需要扩展 state + `buildDirectorPrompt`（`lib/orchestration/prompt-builder.ts`）把这些字段注入上下文
   - 本次计划的**取舍**：Phase 3 只做 Scene 层扩展，chat runtime **暂时忽略**新字段。教师改了 Dify 画布但 chat 里 agent 看不到模块/实验上下文——这在 demo 阶段可接受
   - 后续（GA 前）再单独做 director-graph 的 state 扩展，不作为本计划的一部分
- **关键取舍**：教师只能在画布上改 prompt、加减节点、调模型；**不能改**最终输出节点的 content shape（那会打破本地 `generateSceneActions()` 的契约）

### 权限与发布策略

**核心原则**：draft 和 published 分离。**demo 期用最小防护**（2 层），**GA 前再升级到完整防护**（4 层）。

**账号模型的现实**（评审发现的盲点）：OpenMAIC 教师账号（`lib/server/auth/middleware.ts` 的 session token）和 Dify workspace 成员账号是**两套独立登录**。demo 阶段作者一人兼两者，但 Phase 3 真正开放给教师使用时，两个账号系统没有 SSO 对接——教师每天要登两次，且审计日志无法把"OpenMAIC 里 user X 触发的生成"和"Dify 里 user X' 编辑的 workflow 版本"关联起来。GA 前需要解决这个问题（OIDC/SAML 或临时的"OpenMAIC 用户邮箱 = Dify 账号邮箱"映射）；demo 期可以忽略。

#### Demo 期的 2 层防护（够用）

1. **Zod schema 校验**（`dify-client.ts` 里）：从 Dify 回来的任何 scene content 先过 Zod，失败 fail-fast。这道防护同时抵御"教师改坏 End 节点"和"Dify 本身输出异常"。
2. **Workflow id 的 nominal type 隔离**：`dify-client.ts` 的 `runWorkflow()` 只从 env `DIFY_WORKFLOW_ID` 读 id，函数签名不接受 id 参数；用 TypeScript nominal type `PublishedWorkflowId` 让 draft id 在编译级就无法传入。

**发布动作**（demo 期）：教师在 Dify Studio 里手动点 Publish，然后手动更新 `DIFY_WORKFLOW_ID` env 并重启 OpenMAIC（或 hot-reload 环境变量）。是否能自动化取决于 Phase 0.5 spike 1 的结果。

#### GA 前的完整 4 层防护（本计划**不包含**，作为升级项记录）

- 上述 2 层
- \+ CI 对 `ops/dify-workflows/v*.yml` 的 DSL diff 检查（发布前导出新 DSL，和历史版本比对 End 节点结构）
- \+ `expectedSchemaHash` 运行时比对（如 Phase 0.5 spike 3 通过）
- \+ 账号 SSO + 审计日志关联
- \+ `POST /api/admin/dify-publish` 自动化发布流程（如 spike 1 通过）

---

## Prompt 模板回流策略（避免双源真相）

**问题**：`lib/generation/prompts/templates/**/*.md` 是现有 prompts 的 git 源。现有 `lib/generation/outline-generator.ts`、`scene-generator.ts`、`requirement-analyzer.ts` **全部**通过 `lib/generation/prompts/loader.ts` 加载这些模板。Phase 1 把它们导入 Dify 后，教师在画布上改了之后不会回流到 git，就会形成"Dify 改一次、本地读旧版本"的漂移。

**策略**（承认现实，降低成本）：

1. **git 仍是本地路径的模板源**（Phase 1 不重写 prompt 加载逻辑）。本地 path 继续读 `lib/generation/prompts/templates/`——不折腾。
2. **Phase 1 开始后，`lib/generation/prompts/templates/` 变成只读**：任何本地修改必须同时手动同步到 Dify 画布；**但优先在 Dify 里改**，不鼓励改本地模板
3. **漂移的现实接受**：demo 阶段 Dify 路径和 local 路径的 prompt 可能会慢慢长不一样。这是可接受的——`GENERATION_BACKEND=local` 作为降级兜底，只要**能生成合法 Scene**就行，不追求质量和 Dify 版本一致。Phase 1 验收里 Scene 数量差 ≤ 1 + 类型分布不显著差异的口径足以容忍 prompt 差异
4. **Phase 2.B 清理时**（demo 结束）：可以考虑把 `lib/generation/prompts/templates/` 目录一起删掉，减少混淆
5. **定期 review（可选）**：每月一次人工扫一下 Dify 画布上的 prompt 有没有显著改动，决定是否反向 backport 回 git（作为参考，不作为运行时依赖）

**放弃的方案**（前版误判了成本）：~~"降级路径用独立硬编码 minimal prompt"~~——这等于要为 `outline-generator.ts` / `scene-generator.ts` / `requirement-analyzer.ts` 重写整套 prompt 加载逻辑（至少 2-3 天），而且两套输出在结构上要等价（否则 Zod 会炸）。对 demo 期的 ROI 不划算，本计划**不采用**。

---

## 观测性与告警

**Metrics**（用 OpenTelemetry 或轻量的 prom-client）：
- `dify_workflow_duration_ms` (histogram, labels: `workflow_id`, `status`)
- `dify_workflow_failures_total` (counter, labels: `reason`: `zod_error` / `timeout` / `dify_error` / `http_error`)
- `dify_token_usage_total` (counter, labels: `model`, `direction`: `prompt` / `completion`)
- `rag_retrieval_duration_ms` (histogram)
- `rag_retrieval_backend` (counter, labels: `backend`: `dify` / `local`)

**Tracing**：
- 在 `classroom-generation.ts` 的 `generateClassroom()` 入口开一个 span
- `dify-client.ts` 的 `runWorkflow()` 创建子 span，记录 `workflow_id`, `http_status`, `retry_count`
- Zod 校验失败时 span 打 error tag

**Alerts**（单实例部署下比较简单）：
- Dify 健康检查探针：每 30 秒 GET `${DIFY_API_URL}/info`，连续 3 次失败告警到用户手机/Slack
- `dify_workflow_failures_total` 5 分钟速率 > 2 次/分钟告警
- 成功率滚动窗口低于 85% 告警（比 90% 低 5 个百分点作为早期预警）

**写入位置**：新增 `lib/server/observability.ts`，提供统一的 `recordMetric()` / `startSpan()` 封装。不引入重型依赖（OpenTelemetry SDK 可选，prom-client 够用）。

---

## 关键技术风险（精简后的真实风险清单）

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **Dify 发布 API 不可机器触发** | Phase 0.5 spike 1 不通过 | 降级为人工 Studio Publish + 服务端 poll workflow 版本列表 API 更新 env（需重启服务）；或放弃自动更新 `DIFY_WORKFLOW_ID`，改用手工运维 |
| **Iteration 事件粒度不够细** | Phase 0.5 spike 2 不通过 | 进度条降级为 per-stage（outline / content / actions 三段）；或 workflow 拆成显式 N 路并行分支 |
| **DSL schema hash 不稳定** | Phase 0.5 spike 3 不通过 | 放弃 `expectedSchemaHash`，只靠 Zod + CI DSL diff 双层防护 |
| **长流程超时** | Phase 0.5 spike 4 的 p95 > 8 分钟 | 拆成多次 workflow 调用（每次 ≤ 5 scene），把进度流式续传 |
| **Dify 版本升级破坏 DSL 兼容性** | Dify 升级后旧 DSL 导入失败 | (a) 升级前在 dev 环境先验证 DSL 兼容性；(b) 保留 `ops/dify-workflows/v*.yml` 多版本对照；(c) 升级窗口提前切 `GENERATION_BACKEND=local` 避免用户感知 |
| **Prompt 双源真相** | 教师在 Dify 改了 prompt，但 git 里的本地 fallback 还在用旧版本 | 见"Prompt 模板回流策略"：接受漂移，local fallback 只求能跑 |
| **并发生成冲突** | 同一 course 两个教师同时点生成 | 在 `classroom-job-store` 加一层 "同 course 同时最多一个 running job" 的幂等检查；拒绝第二个请求并返回 existing jobId |
| **大文件上传超 Dify Dataset 上限** | 用户上传 60 MB PDF | 见 Phase 2.A 动作 6，需要实测 Dify 上限后决定是否分片 |
| **Scene content shape 漂移** | 教师在 Dify 画布改了 End 节点结构 | Zod 校验 fail-fast + CI schema sync guard + nominal type workflow id 三层防护（见"权限与发布策略"） |
| **Dify 内部依赖（postgres/redis）故障** | Dify 自身的底层服务挂掉 | 健康探针 + `GENERATION_BACKEND=local` 降级开关，30 秒内感知并切回本地 |
| **Dify LLM provider 支持集是 OpenMAIC 的子集** | OpenMAIC `lib/ai/providers.ts` 支持 15+ provider（openai / deepseek / kimi / glm / siliconflow / doubao / anthropic / google / ...），Dify 的 provider 支持列表可能更窄或对某些国产 provider 的适配层质量不同。当前生产主力 provider 若未被 Dify 原生支持，整个 Dify 路径会黄 | **Phase 0.5 spike 必须前置做 provider 交集检查**：列出项目当前实际在用的 provider，对照 Dify 最新版本的 provider 列表。不支持的 provider 有三条路：(a) 用 Dify 的 OpenAI-compatible 自定义 endpoint 接入（需要 provider 本身有 OpenAI 兼容 API）；(b) 关键 LLM 调用在 OpenMAIC 本地走 `lib/ai/providers.ts`，Dify 只做编排和其他节点（需要改 workflow 设计）；(c) 放弃该 provider，改用 Dify 支持的替代 |
| **教师误操作破坏 Workflow** | 教师在画布上删了关键节点并发布 | draft/published 分离：发布是显式动作；published 出问题可以在 Dify Studio 里回滚到上个版本，env 里的 `DIFY_WORKFLOW_ID` 指向历史版本也行 |

---

## 关键文件

### Phase 0 删除
- `lib/generation/pipeline-runner.ts` — 唯一真死代码
- `app/api/generate-classroom/route.ts` POST handler — 无前端调用（保留 `[jobId]/route.ts` GET handler）

### Phase 0 改造
- `lib/generation/generation-pipeline.ts:50` — 只移除 `createGenerationSession, runGenerationPipeline` 这一行 re-export，其余 40 行 barrel 保留
- （其他文件不动——真实入口 `/api/course/[courseId]/classrooms` 已有完整鉴权和 courseId 注入）

### Phase 1 新增
- `lib/server/dify-client.ts` — Dify Service API 客户端，env-based config（~180 行）
- `lib/server/dify-schema.ts` — 4 种 Scene Content Shape 的 Zod schema（**~800 行**，不是 150）
- `lib/server/generation-backend.ts` — `pickGenerationBackend()` 单一决策函数（~40 行，env-only，无 orgId）
- `lib/server/observability.ts` — metrics + tracing 封装（~100 行）
- `scripts/check-dify-schema-sync.ts` — CI 守卫：slides.ts/pbl types 变更必须同步到 dify-schema.ts
- `app/api/admin/dify-publish/route.ts` — 显式发布 endpoint（具体实现由 Phase 0.5 spike 1 决定；若 spike 1 不通过则**此文件不建**，改用人工流程）
- `tests/dify-pipeline.test.ts` — Dify 与本地 pipeline 对比测试（χ² 宽松口径）
- `tests/dify-schema.test.ts` — 4 种 content shape Zod 校验单测
- `tests/backend-switching.test.ts` — `pickGenerationBackend` 行为单测
- `ops/dify-workflows/v1.yml` — 种子 workflow DSL，版本化存 git
- `ops/evaluation/rubric.md` — 教学契合度评分 Rubric
- `ops/evaluation/dify-spike-report.md` — Phase 0.5 spike 实测报告

### Phase 1 改造
- `lib/server/classroom-generation.ts` — 主入口，`generateClassroom()` 里接入后端分流
- `.env.example` — 新增 `GENERATION_BACKEND` / `DIFY_API_URL` / `DIFY_API_KEY` / `DIFY_WORKFLOW_ID`

### Phase 2 新增
- `lib/rag/dify-indexer.ts` — Dify Dataset 索引（不替换本地 `indexer.ts`）
- `lib/rag/dify-retriever.ts` — Dify Dataset 检索（不替换本地 `retriever.ts`）

### Phase 2 改造
- `lib/rag/index.ts` — facade 层，按 `pickGenerationBackend()` 分流
- `app/api/course/[courseId]/documents/route.ts` — 通过 facade 走 Dify 或本地
- `app/api/course/[courseId]/documents/[docId]/route.ts` — 同上，DELETE 时同时删 Dify dataset 内对应 document

### Phase 3 改造
- `lib/types/stage.ts` — 扩展 `Scene` / `SceneContent` 加 `modules?` / `experiments?`
- `lib/server/classroom-generation.ts` — 合并 Dify 返回的新字段
- `lib/server/dify-schema.ts` — Zod schema 同步扩展

### 本次迁移不动（保留作为降级兜底）
- `lib/rag/indexer.ts` / `lib/rag/retriever.ts` / `lib/rag/embeddings.ts` / `lib/rag/chunker.ts` — `GENERATION_BACKEND=local` 时的本地实现
- `prisma/schema.prisma` 的 `DocumentChunk` 模型 — 保留至 Phase 2.B
- `lib/generated/prisma/*` 相关代码 — 随 schema 保留

### 完全不动
- `lib/action/engine.ts` — B 层
- `lib/playback/engine.ts` — B 层
- `lib/orchestration/director-graph.ts` — B 层（Phase 3 可能补 modules/experiments 字段，见 Phase 3 动作 4）
- `lib/generation/action-parser.ts`, `scene-generator.ts` 中的 action 生成部分 — C 层，保留在本地
- `lib/ai/providers.ts` — 保留给 action 生成、chat runtime、TTS、image 用

### 可复用的现有工具
- `lib/server/auth/middleware.ts` 的 `authenticate()`
- `lib/server/permissions.ts` 的 `checkCourseAccess()`
- `createLogger()` from `lib/logger.ts`

---

## 验收门槛（可测口径）

**用户已确认的两个硬指标**：生成成功率 ≥ 90%、教学契合度 ≥ 80%。

### 指标 1：生成成功率 ≥ 90%

- **定义**："成功" = `/api/generate-classroom` 请求返回 Scene[]，且 Zod 校验通过，且浏览器端可加载播放（无 runtime 报错）
- **统计窗口**：**最近 100 次**真实/合成请求（滚动窗口）
- **计算方法**：`success_count / total_count >= 0.90`
- **数据来源**：`lib/server/observability.ts` 的 `dify_workflow_failures_total` counter + 前端 playback 初始化成功事件上报
- **门禁**：Phase 1 的 smoke test（10 个固定需求）必须 ≥ 9 次成功；不达标不允许进入 Phase 2

### 指标 2：教学契合度 ≥ 80%

- **定义**：生成的课件在 "与用户需求匹配度 / 学情适配 / 内容准确性 / 结构合理性" 四个维度的综合得分
- **样本窗口**：Phase 1 结束时抽样 **20 份**生成结果（覆盖不同学科、不同学段）
- **评分方法**：统一 Rubric，每维度 0-100，四维度等权平均；评分人 2 人独立打分取均值，分差 > 15 时第三人仲裁
- **计算方法**：20 份样本的评分均值 ≥ 80
- **Rubric 位置**：`ops/evaluation/rubric.md`（Phase 1 开始前先落 Rubric 文档）
- **门禁**：Phase 3 开放教师画布前，必须在最新 published workflow 上重跑一次评测；不达标回退 workflow 版本

### Phase 0.5 验收
- Spike 1 / 2 / 3 / 4 / 5 全部有明确 go/no-go 结论，写入 `dify-spike-report.md`
- 每个 spike 不通过时的退化方案要落实到 Phase 1 的代码实现中

### Phase 0 验收
- `pnpm test && npx tsc --noEmit && pnpm lint` 全绿
- `grep -r "pipeline-runner\|runGenerationPipeline\|createGenerationSession" lib/ app/` 零匹配
- `grep -r "fetch.*'/api/generate-classroom'" app/` 零匹配（确认 POST handler 删除后无前端断链）
- `app/api/generate-classroom/[jobId]/route.ts` 的 GET handler 仍可访问（`lib/server/classroom-job-runner.ts` 内部轮询路径不受影响）
- 通过 `/course/[courseId]` 页面完整走一次创建课程流程，行为完全不变

### Phase 1 其他验证
1. **Dify 单测**：在 Dify Studio 里直接 Run 一次 workflow，用固定需求（"高中生物 光合作用 45 分钟"），输出 JSON 通过服务端 Zod
2. **后端切换单测**：`tests/backend-switching.test.ts` 覆盖 `GENERATION_BACKEND=local/dify/unset` 三种情况
3. **集成测试**：`GENERATION_BACKEND=dify pnpm dev`，浏览器走完整创建课程流程，对比 local 路径的 Scene 输出
4. **既有测试保持绿**：`pnpm test + npx tsc --noEmit + pnpm lint`

### Phase 2 其他验证
1. `tests/rag-e2e-test.ts` 改造后验证 Dify 检索 top-k 相关性不回退
2. **课程隔离测试**：courseId=A 上传含独特关键词 "zzzqqq" 的文档 → courseId=B 检索 → 检索不到
3. **大文件边界测试**：30/50/60 MB PDF 各测一次
4. **facade 双向覆盖**：验证 `classroom-generation.ts` 和 `app/api/chat/route.ts` 两条调用路径都正确分流

### Phase 3 其他验证
1. 画布上加/删 "课程模块设计" 节点，走 E2E 流程（`pnpm test:e2e`）
2. **schema 漂移测试**：手动把 Dify End 节点输出结构改成不兼容的 shape，验证 `dify-client.ts` Zod 校验 fail-fast
3. **发布策略测试**：构造一次调用试图传 draft workflow id，类型系统应编译失败；运行时防护也应拒绝

### 回滚方案（单实例 demo）

本地 RAG 全程保留，回滚是"切开关"而不是"还原数据"：

1. **全局回滚**：`GENERATION_BACKEND=local`，立刻切回本地 pipeline + 本地 RAG（一个 env 变量 + 重启服务）
2. **Dify 实例级故障**：健康探针失败 → 告警 → 运维手动切 env → 重启
3. **数据层无需回滚**：`DocumentChunk` 表一直在，本地 RAG 代码一直在；Dify 那边的 dataset 即使保留也不影响本地路径
4. **workflow 回滚**：Dify Studio 里把 `DIFY_WORKFLOW_ID` 指向历史 published 版本

demo 阶段的重点是快速试错；等 Dify 路径跑稳了再进 Phase 2.B 清理阶段。

---

## 一句话结论

**不要试图把 OpenMAIC 整个搬进 Dify**——playback + whiteboard + multi-agent chat runtime 是产品的"心脏"，Dify 不具备表达它们的原语。**正确的做法是让 Dify 取代生成链路**（Phase 1），**接管 RAG**（Phase 2），**暴露画布给教师**（Phase 3），让 OpenMAIC 保持做它擅长的——action 执行、playback、实时 chat。单实例部署让整个迁移的代码复杂度降到最低：无路由、无机构建模、无多租户权限，教师拿到的是一个"开箱即用的可视化备课流水线"。**动工前的硬门槛是 Phase 0.5 的 4 个 spike**——没跑通这 4 个 spike 之前，Phase 1 的任何代码都不要写。
