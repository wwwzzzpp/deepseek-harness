# DeepSeek Harness 原生文章树工作台交接

更新时间：2026-08-29

这份文档是下一位 Agent 的执行入口。它记录最终产品目标、当前未提交工作区、已经实现的机制、已知缺口、风险和推荐实施顺序。设计理由以 [Article tree workbench Agent Note](../notes/implemented/feature/2026-08-29-article-tree-workbench.md) 为准，产品完成状态以 [Requirements Completion Log](../../docs/requirements-log.md) 为准，公开类型与事件以 [article subsystem](../../docs/subsystems/article.md) 和源码为准。

## 接手后的第一原则

当前工作区包含大量未提交改动。不要运行 `git clean`、`git reset --hard`、`git checkout -- .`，不要用生成器或格式化器覆盖不明改动，也不要把当前实现当成已经通过发布验收的成品。

交接时观察到的分支是 `dev`，基线提交是 `47f943859b`，`git status --short` 有 56 个已修改或未跟踪路径。该数字只是一份交接快照；接手后必须重新检查真实状态。

先运行：

```sh
cd /Users/wzp/Documents/GitHub/deepseek-harness
git status --short
git diff --check
```

本机可用的 pnpm 入口是：

```text
/Users/wzp/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
```

如果普通 `pnpm` 不在 PATH，后续命令都使用这个绝对路径。不要因为命令找不到就重新安装依赖或改 lockfile。

## 最终必须交付的产品

用户希望把 `/Users/wzp/Documents/GitHub/personal-publishing-system` 的写作方法迁移到 DeepSeek Harness，并在 Harness 上继续开发。旧工程只提供产品语义参考，不要求 API、文件名、数据库或界面兼容，不应把旧 Web 应用嵌入 Harness，也不应继续维护两套状态来源。

最终产品是一个可选的 Harness 第一方 Bundle。加载 `@deepseek-ai/dsh-article-workbench` 后，每个聊天输入区出现紧凑文章控制面板。用户在聊天中完成研究和写作，面板负责显示状态并执行高成本人工动作；模型工具只能读写当前分支，不能替用户创建分支、回退、合并或覆盖其他文章线。

最终用户流程需要达到：

```text
聊天形成选题与素材
  -> 生成草稿
  -> 规划配图并把 ASCII 草图放到正文位置
  -> 人工同时审核文字和配图方案
     -> 有修改意见：改草稿并回到人工审核
     -> 明确通过：生成终稿
  -> 按审核通过的方案生成正式图片
  -> 单图改图、重试、选择历史图片版本
  -> 必要时从终稿退回任一历史草稿，重新走审核和终稿
```

整个流程必须保留以下产品不变量：

- Session 日志是文章状态、正文版本、分支关系和人工动作的权威来源；Markdown 与图片文件是可编辑或可预览的工作副本。
- 根文章也是一个 `ArticleBranch`。每个子分支关联一个普通 Harness Session，并可继续创建孙分支。
- 子分支继承分叉时最近完整对话、当前文章阶段和文档副本，之后完全独立。
- 父分支、子分支和兄弟分支拥有独立的 CAS revision、正文版本、图片选择、文件目录、任务和回退历史。
- 插件不提供自动合并，不自动把其他分支内容加入模型请求，不允许子分支覆盖父分支。
- Agent 正在运行时只保存分支想法；本轮结束后再次由用户确认，才能从完整轮次创建子 Session。
- 回退只改变当前分支当前选择的版本，不删除历史草稿、旧终稿或旧图片版本。
- 未同步的外部 Markdown 修改不得被模型写入、阶段推进、重新导出或回退静默覆盖。
- 已经创建的 Session 即使文章初始化失败也不得被静默删除；界面必须允许重试初始化、打开普通分叉对话或取消文章关联。
- 插件卸载或不加载时，普通聊天、普通 Session fork 和其他 Harness Bundle 不受影响。

推荐保留 `idea | draft | review | final` 四个正文主阶段，把草稿期配图规划和终稿期图片生产建模为分支内子流程，而不是把每个图片动作都塞进正文阶段枚举。这个选择尚未实现；如果接手者发现 Harness Jobs 或 UI 更适合扩展主状态机，应先更新 Agent Note，再一次性更新事件、Projection、Remote、UI、文档和测试。

## 当前完成度结论

当前实现已经建立文字文章树的主要骨架，约 4,000 行 article、control、workspace、tool 和 UI 源码及测试已经写入工作区；包清单、TypeScript faces、Remote 客户端、事件登记、生成目录和双语文档也已接入。

但是当前状态不能称为“插件完成”：

- 改动尚未提交。
- 最新生成文档修复后没有重新跑完整 `doc-sync`。
- control、workspace、tool、UI 和 Bundle 基本没有专属行为测试。
- 没有真实 Bundle 装配的 keyless snapshot，也没有浏览器交互验收。
- 人工审核文档闭环尚未完成。
- 生图、改图、图片版本选择和图片回退尚未实现。

因此正确表述是：文字文章树架构和第一版实现已存在，仍需先完成文字闭环与发布门禁，再实现分支隔离的图片工作流。

## 已经实现的包与职责

### `@deepseek-ai/dsh-article`

位置：[packages/article/article](../../packages/article/article/)

服务键是 `ctx.articles`。该包定义 `ArticleTreeId`、`ArticleBranchId`、`DocumentRevisionId`、`ArticleBranchRequestId`、四个正文阶段和完整 `ArticleSnapshot`，并把 `ArticleTreeId`、分支谱系、当前正文指针、workspace 元数据和 CAS revision 放入分支状态。

已经注册四类 Session 事件：

- `article/document`：不可变 Markdown 正文版本，正文内容保存在 Session 日志。
- `article/change`：每次文章突变后的完整分支状态。
- `article/branch-change`：可恢复的创建分支请求与父子关系。
- `article/action`：下一步、退回、回退、创建分支等人工动作审计。

[fold.ts](../../packages/article/article/src/fold.ts) 对 durable 输入进行严格解码与重放，检查文档归属、版本递增、阶段变化、分支请求状态机和文档计数。[index.ts](../../packages/article/article/src/index.ts) 提供创建根分支、初始化子分支、保存文档、进入审核、退回草稿、选择历史草稿、更新 workspace、创建和恢复分支请求、Remote 查询等能力，并注册 `article` Session Projection。

已经修复一个重要继承问题：子 Session 的 fork seed 会带入父 Session 的 `article/branch-change` 事件。Projection 原本会过滤父请求，但 service cache 仍可能读到并修改父请求。现在 `getBranchRequest` 与 `updateBranchRequest` 都按当前 `ArticleSnapshot` 检查 request 的父分支和父 Session，回归测试位于 [service.spec.ts](../../packages/article/article/tests/service.spec.ts)。后续修改 replay 或 fork 逻辑时不得移除这层归属检查。

### `@deepseek-ai/dsh-article-workspace`

位置：[packages/article/article-workspace](../../packages/article/article-workspace/)

服务键是 `ctx.articleWorkspace`。它把当前分支文档物化到：

```text
.dsh/article/<tree-id>/<branch-id>/
├── material.md
├── draft.md
├── review.md
└── final.md
```

每个文件在 `ArticleWorkspaceSnapshot` 中记录路径、基础文档版本和 SHA-256 digest。`materialize` 在写文件前检查已跟踪文件是否被外部修改，也拒绝覆盖同名的无关文件；`synchronize` 把外部修改导入为新的 `human-file` 不可变版本；`assertClean` 阻止带未同步修改的模型写入和回退。

路径由 Session 的绝对 `cwd`、tree id 和 branch id 构成，并检查 id 是否可安全作为目录段。文件使用原子写入，权限为文件 `0600`、目录 `0700`。

### `@deepseek-ai/dsh-article-control`

位置：[packages/article/article-control](../../packages/article/article-control/)

服务键是 `ctx.articleControl`，也是 UI 进行人工动作的 Remote 接口。它已经提供：

- 创建根文章并初始化 workspace 元数据。
- “下一步”：idea 时向 Agent 排队生成 draft；draft 时提交 review；review 时向 Agent 排队生成 final。
- review/final 退回当前 draft。
- 选择任一当前分支历史 draft 作为当前 draft。
- 同步 Markdown 外部修改。
- 保存、确认、重试、取消分支创建请求。
- 使用现有 Agent/Session 创建路径创建子 Session，继承 cwd、模型设置、Agent Preset 和截至最近完整轮次的 seed。
- 初始化子分支本地文档版本、附加 workspace、设置子 Session 标题、发送 exploration idea，并返回 child Session id。

创建 Session 后如果初始化失败，父请求进入 `failed` 并保留 child Session id。成功后请求进入 `ready`。如果 Agent 正在运行，`createBranch` 只创建 `draft` 请求；`confirmBranch` 在 Agent idle 后按最新完整轮次和最新文章版本创建一个新的 request，再执行 fork。

### `@deepseek-ai/dsh-tool-article`

位置：[packages/article/tool-article](../../packages/article/tool-article/)

已经注册：

- `article_read_current`：返回当前分支精确 `branch_id/revision` 和当前 Markdown 文档。
- `article_write`：用精确 branch/revision CAS 保存 `material | draft | review | final` 的不可变版本，并重新物化工作目录。

写工具先检查 workspace clean，不能跨分支写入；提示词明确禁止模型创建分支、合并或回退。`writable: false` 可只暴露读取能力。工具结果使用 generic card render intent。

### `@deepseek-ai/dsh-client-ui-article`

位置：[packages/client/ui-article](../../packages/client/ui-article/)

面板注册到 `conversation.input.dock`，id 为 `article`。已经实现：

- 空 Session 创建根文章表单。
- 标题、分支路径、四阶段、当前 revision 和当前文档显示。
- 下一步、打开当前 Markdown、同步、退回草稿、新建分支、查看树、返回父分支。
- 历史草稿列表与选择回退。
- 分支名称和新想法表单。
- Agent 运行中保存想法、运行结束确认。
- 创建失败后的重试、打开 child Session、取消关联。
- 从 session list 中的 `article` Projection 重建递归分支树并打开节点 Session。
- 中英文 UI 文案与基本窄面板样式。

UI 通过 `@deepseek-ai/dsh-api-remotes` 生成的 Remote client 调用 host 服务，文件打开使用 workspace client，Session 导航使用 `ctx.sessions.open()`。

### `@deepseek-ai/dsh-article-workbench`

位置：[packages/bundle/article-workbench](../../packages/bundle/article-workbench/)

[cordis.patch.yml](../../packages/bundle/article-workbench/cordis.patch.yml) 依次挂载 article、article-workspace、article-control、tool-article 和 ui-article。它是可选 Bundle，不修改默认 web-app Bundle。当前 tool-article 是 Bundle 范围内的全局工具行，因此加载 Bundle 后每个 Agent 都能看到工具 schema，但没有 article branch 时读取返回 null、写入被拒绝。

## 已修改的装配与生成面

除新包外，当前工作区还修改了以下系统连接点：

- `tsconfig.base.json`、`tsconfig.host.json`、`tsconfig.client.json`：加入新包路径和 host/client faces。
- `packages/api/remotes`：生成并导出 article 与 article-control Remote client。
- `packages/core/session/src/known-event-types.ts`：登记四类 article Session 事件。
- `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`：登记 article dock slot。
- `scripts/gen-tool-catalog.ts`：装配 article tools 并生成工具目录。
- `scripts/gen-cordis-catalog.ts`：把 article 服务、事件和类型路由到 article subsystem 页面。
- `scripts/gen-doc-graphs.ts`：加入 article、workspace、control 的服务关系和持久化说明。
- `packages/extensions/tool-cordis/src/api-catalog.ts`、多个 `docs/*catalog*` 和 graph 文档：生成结果，不能手工维护英文生成区。
- `pnpm-lock.yaml` 与 package group README：登记新 workspaces 和 Bundle。
- [Article tree workbench Agent Note](../notes/implemented/feature/2026-08-29-article-tree-workbench.md)、[article subsystem](../../docs/subsystems/article.md)、[requirements log](../../docs/requirements-log.md)：记录决策、公开类型和当前部分完成状态。

## 已经运行过的验证

以下结果来自当前开发过程，但不全部覆盖最后一次文档生成后的工作区，接手者必须按下一节重新运行：

- `pnpm run typecheck` 曾通过两次。
- `pnpm exec vitest run packages/article/article/tests/fold.spec.ts packages/article/article/tests/service.spec.ts` 通过，共 2 个测试文件、5 个测试。
- `pnpm run lint` 曾通过。
- `pnpm run verify-export-jsdoc` 通过。
- `pnpm run verify-agent-note-format -- .agents/notes/implemented/feature/2026-08-29-article-tree-workbench.md` 通过。
- tool、client、config、persistence、Cordis 和 doc graph 生成器已经运行。
- 已修改双语文档的 translation pairing sidecar 已经重新记录。
- 本交接前 `git diff --check` 通过。

最近一次完整 `doc-sync` 在后续修复前是 26 项通过、2 项失败：translation pairing 报四个生成文档未同步；VitePress 把 `.dsh/article/<tree-id>/<branch-id>/` 中的尖括号当成未闭合 HTML。生成器已经改用 `.dsh/article/{tree-id}/{branch-id}/`，四个中文对应文档和 sidecar 也已更新，但修复后尚未重新运行 `doc-sync`。这不是已知仍然失败，而是尚未取得最新证据。

## 接手后立即执行的收口顺序

先不要继续加图片功能。先把当前文字实现恢复到可验证基线。

1. 运行完整 `doc-sync`，只按输出修复真实失败。生成英文目录失败时修改生成器或源码 owner，不要手改英文生成区。
2. 重新运行 `typecheck` 和 article focused tests，确认最后一次生成与 Remote face 改动没有破坏编译。
3. 运行 `lint`、`verify-export-jsdoc` 和 `git diff --check`。
4. 运行 `build`，验证新增包实际产出 `lib/`、Typert host/remote client 和 client bundle。
5. 运行 `hygiene`，重点处理 workspace constraints、publint、knip、NodeNext consumer 和包导出问题。
6. 给当前文字工作台补齐缺失测试与真实装配示例后，再运行相关 keyless snapshot 和浏览器测试。

建议命令：

```sh
/Users/wzp/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run doc-sync
/Users/wzp/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run typecheck
/Users/wzp/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm exec vitest run packages/article/article/tests/fold.spec.ts packages/article/article/tests/service.spec.ts
/Users/wzp/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run lint
/Users/wzp/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run verify-export-jsdoc
/Users/wzp/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run build
/Users/wzp/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run hygiene
git diff --check
```

不要为了“看起来全绿”一次性跑全仓库 test 并忽略 focused failures。先证明新增行为，再按仓库规则为用户可见行为补 keyless snapshot；CI 承担无关平台的穷举测试。

## 文字工作台尚未完成的关键工作

### 1. 人工审核闭环是最高优先级缺口

当前 `draft -> review` 的“下一步”只调用 `submitReview` 改变 stage，不创建 `review` 文档。UI 在 review stage 会把“当前稿”映射到 `review.md`，但 `currentDocuments.review` 通常为空，因此“打开当前稿”不可用。随后 `review -> final` 的 workflow message 要求模型读取 review notes，但系统没有保证这些 notes 存在。

接手者应把审核做成真实可操作流程：

- 进入 review 时创建或物化 branch-local `review.md` 模板，包含文字审核、事实/观点/猜测、删除/保留、标题、配图位置和最终修改要求。
- 用户可以直接编辑并同步 `review.md`，也可以在聊天中表达审核意见，由模型在当前分支写入 review 文档。
- 未明确通过时，“下一步”不得直接生成 final；应根据 review 意见生成新的 draft，清除当前 review/final 指针，然后重新进入 review。
- 只有明确人工批准后才能排队生成 final。批准事实必须以结构化 Session 事件或可严格解析的审核状态保存，不能只靠临时 UI 状态。
- final 必须读取当前 draft、当前 review 和已批准配图方案。
- review 循环、批准、打回和恢复后重放都要有单元与 keyless snapshot 覆盖。

不要直接复制旧项目的中文正则作为唯一批准机制。优先让 UI 提供明确“批准生成终稿”和“按意见改稿”两个动作，把用户意图记录为结构化事件；review.md 的文字仍用于内容上下文。

### 2. 工作目录生命周期需要补测试和明确策略

当前 root article 在没有任何文档时只记录 workspace directory，未必会在磁盘上实际创建空目录。需要测试并决定“创建根文章后目录必须立刻存在”还是“首个文档写入时创建”；用户原始验收倾向前者。

回退到 draft 会清除 `currentDocuments.review/final`，但 `materialize` 从旧 workspace files 开始复制，旧 `review.md/final.md` 可能仍留在磁盘并继续被 `assertClean` 检查。必须明确工作副本策略：推荐保留 durable 历史在 Session log，工作目录只表达当前选择；对不再当前的文件不要静默删除用户外部编辑，可以移入 branch-local history/ 或停止跟踪并在 UI 明确提示。实现前补冲突与回退测试，禁止粗暴 unlink。

至少补充：首次 materialize、重复 materialize、外部 dirty、无关同名文件、同步 noop、同步新版本、CAS stale、非法 cwd/path、回退时 dirty、回退后旧 final 工作副本处理、父子目录隔离。

### 3. 分支创建与恢复需要真实 service 测试

当前只有 fold 和 inherited request regression tests。需要使用实际 Agent/Session test harness 覆盖：

- 根分支在 draft/review/final 分别创建子分支。
- 子分支再创建孙分支。
- fork seed 只到最近完成 turn，不携带半个 assistant turn。
- Agent running 时保存 draft request，idle 后确认时使用最新文章 revision。
- 子 Session 继承 cwd、模型配置和 Agent Preset。
- 父文档被复制成新的 child document id，source 为 `branch-seed`。
- 子分支写入、同步和回退不改变父 Session 事件与文件。
- Session 已创建但 workspace 或 article 初始化失败时保留 child id。
- failed request 的重试不会重复创建 child Session 或重复发送 exploration idea。
- 应用重启后 failed child Session 不在 live agent registry 时仍可恢复初始化。当前 `retryBranch` 只用 `ctx.agents.get(childSessionId)`，冷 Session 很可能再次失败；需要通过 Harness 的 session/agent 打开或恢复机制解决。
- cancelled 只取消文章关联，不删除 child Session。
- 多个请求、冷 Projection 和 session list 分页/加载时树仍然可恢复。

`stableForkSeed` 使用 Session event seq 计算切点，必须用真实 Session 序列测试其索引假设，不要只测手造数组。

### 4. 模型工具需要测试与更完整动作收尾

给 `article_read_current` 和 `article_write` 增加 tool registry 级测试：无 article、只读配置、正确读当前文档、branch id 错误、stale revision、dirty workspace、非法阶段写 final、写 draft 清 review/final、成功写入后物化、不能写父/兄弟分支。

当前 `next` 在触发模型生成时记录 `article/action requested`，但没有在模型成功写入 draft/final 后把相应 action 记录为 completed，也没有在模型失败或停止时记录 failed。应通过 article/tool 或 agent lifecycle 关联本次 workflow action，保证审计事件真实闭合，同时避免把一般聊天中的手动 `article_write` 误算成“下一步完成”。

### 5. UI 状态和无障碍需要补齐

当前分支树对每个节点无条件显示“外部修改状态同步时检查”，并没有真实展示“是否存在未同步外部修改”。如果产品继续承诺该状态，需要 host 端提供按分支检查或 cached dirty 状态；不能用静态文案冒充状态。冷分支的文件不应为了画树而全部扫描，可只显示 unknown/clean/dirty 三态并在打开或同步时刷新。

需要使用 client test runtime 和 Testing Library 覆盖空态、正常四阶段、pending action、Remote error、rollback list、running saved idea、failed retry、recursive tree、父 Session 跳转、按钮禁用、键盘操作、focus、ARIA、窄屏。随后用真实 Web profile 加 article Bundle 做浏览器验收，确认 dock 不遮挡输入区、不挤坏移动宽度、打开 Session 和打开文件真的工作。

### 6. Bundle 需要一个真实可运行入口

当前只有可安装 patch carrier，没有专门示例证明 `web-app + article-workbench` 的真实加载顺序、Remote 生成、client asset 和 Session projection 共同工作。增加一个最小 runnable example 或 snapshot fixture，按现有 bundle/profile 机制加载，不要把 article-workbench 硬塞进默认 web profile。

Keyless snapshot 至少证明：创建根文章、模型看到 article tools、写入 draft 形成事件与文件、进入 review、打回修改、批准 final、创建 child Session、child projection 独立、重启重放。GUI 测试再负责按钮与视觉交互，不要用组件 mock 代替 assembled application transcript。

## 图片工作流的剩余设计与实现

图片不是简单在 final.md 中保存 URL。它需要与正文相同的分支隔离、不可变版本和人工控制。

建议新增独立 package 角色，而不是把二进制和 job 逻辑塞进 `dsh-article`：

```text
packages/article/article-assets       图片槽位、图片版本、选择状态和事件
packages/article/article-image-control 生图、改图、重试、取消、版本选择
packages/article/tool-article-image    模型读取配图简报和提交图片任务所需的受限工具
packages/client/ui-article             扩展图片任务、预览、改图和回退面板
packages/bundle/article-workbench      追加 attachments/jobs/provider rows
```

具体包名可按仓库命名审查调整，但职责必须分开：article domain 不直接调用图片供应商；Attachments 保存不可变媒体，Jobs 管理长任务与取消，图片 provider 负责实际生成或编辑，control 负责分支和人工动作。

建议的核心数据：

- `ArticleImageSlotId`：正文中一处配图位置。
- `ArticleImageRevisionId`：一次不可变的生成、编辑或上传结果。
- `ArticleImageSetRevision`：当前分支图片选择集合的 CAS revision。
- slot 保存用途、正文锚点、alt text、审核通过的提示、宽高/比例和当前选中 image revision。
- image revision 保存 branch id、attachment id、来源类型、父 image revision、prompt、provider/job id、创建时间和失败信息。
- 子分支创建时复制 slot 与“当前选中图片 revision”的来源关系；底层 immutable blob 可以共享 attachment，但 child 的选择、编辑、删除和任务必须独立。

需要新增 durable 事件并严格重放，例如：

- `article/image-plan-change`
- `article/image-revision`
- `article/image-selection-change`
- `article/image-action`

准确名称应在实现时统一确定。所有事件必须登记到 known event types、Projection、persistence catalog、event map 和 subsystem 文档。

图片流程建议拆成两段：

1. draft 阶段的 visual plan：读取完整 draft，创建配图简报与 ASCII/结构草图，插入正文稳定锚点，进入 review 时和文字一起给用户审核。这一阶段不调用正式生图 provider。
2. final 阶段的 image production：只根据已批准 slot 生成正式图片。每个 slot 可独立生成、取消、重试、改图、上传替换、选择历史版本；最终 Markdown 只引用当前分支当前选中的 attachment。

“改图”必须创建新 revision 并保留 parent image revision，不能覆盖原图。“删除”默认只取消当前选择或移除 slot，不物理删除可能被历史版本或其他分支引用的 attachment。真正的 blob GC 属于 Attachments 的引用生命周期，不应由 UI 按钮直接执行。

图片工作流验收至少包括：

- 草稿配图方案在 review 前可见并可打回。
- 明确批准前不能启动正式生图。
- 同一分支多个 slot 可并行 job，状态独立。
- 单图失败不破坏其他图片，支持重试与取消。
- 改图保留原版并可切回历史版本。
- 父分支生图、改图或选图不改变 child，反之亦然。
- 从 final 带图状态退回 draft 后，旧 final 与旧图永久保留，但不再被当前 draft 误当成已批准结果。
- 应用重启后 job 与图片 Projection 可恢复；完成但尚未投影的 job 能幂等收敛。
- Markdown 中 attachment 引用与当前 image selection 一致，不出现跨分支相对路径覆盖。

## 推荐的完整迭代顺序

### M0：当前工作区变绿

完成 `doc-sync`、typecheck、focused tests、lint、build、hygiene 和 diff check，修复 package/Remote/generated doc 问题，不扩产品功能。

完成标志：当前文字包可以从干净构建产出，所有现有生成目录新鲜，文档站构建通过。

### M1：文字人工审核闭环

创建 review 工作副本、结构化批准/打回动作、按意见改稿并返回 review、批准后生成 final，补 action 完成/失败审计。

完成标志：用户可以连续多轮“审核意见 -> 新草稿 -> 再审核”，没有明确批准就永远不会生成 final。

### M2：workspace、control、tool 的行为测试

补冲突、CAS、fork、retry、cold restore、父子隔离和 tool tests，解决回退后旧工作副本策略与 cold child retry。

完成标志：三层分支在重启前后都能创建、同步、回退和导航，父子状态与文件不互相变化。

### M3：UI 与真实 Bundle 装配

补组件测试、无障碍、真实 dirty 状态、runnable example、keyless Web Snapshot 和浏览器验收。

完成标志：从真实 Harness Web UI 完成根文章到终稿、分叉、孙分支、回退和失败恢复，刷新后结果一致。

### M4：草稿期配图规划

实现 image plan/slot、配图简报、ASCII 草图/正文锚点和 review 联动，仍不正式生图。

完成标志：review 同时显示文字与配图方案，任何修改都会回到 draft/review 循环。

### M5：正式生图与改图

接入 Attachments、Jobs 和图片 provider，完成 slot 级生成、取消、失败、重试、改图、上传与版本选择。

完成标志：每个分支独立管理自己的图片版本，任务重启可恢复，旧图可回选。

### M6：全链路回退与加固

覆盖带图 final 退回历史 draft、重新审核、重新 final、重新选图；补故障注入、窄屏、键盘、冷 Session、插件卸载和无自动合并证明。

完成标志：根分支、子分支和孙分支都能独立完成文字与图片全流程，任一分支回退不会改变其他分支。

## 测试矩阵

| 层级 | 必须证明的行为 | 建议位置 |
| --- | --- | --- |
| Fold unit | durable 解码、阶段、CAS、文档归属、branch request、image revision、非法 replay 拒绝 | `packages/article/*/tests` |
| Service unit | create/save/review/rollback、workspace conflict、fork/retry/cold restore、父子隔离 | 对应 service package tests |
| Tool unit | schema、render intent、读写 fence、dirty/CAS/阶段错误、只读配置 | `tool-article` 与未来 image tool tests |
| Client component | 空态、动作状态、错误、树、审核、图片任务、键盘、ARIA、窄屏 | `packages/client/ui-article/tests` |
| Keyless snapshot | 真实 Bundle、真实 Session events、模型可见工具与 workflow 消息、重启重放 | runnable example 下的 snapshot tests |
| Browser/GUI | Dock 布局、点击、文件打开、Session 跳转、任务进度、预览与版本回退 | Web GUI tests / browser acceptance |
| Build/hygiene | package exports、Typert faces、client bundle、Cordis config、publint、NodeNext | root scripts |

## 容易踩坑的实现约束

- 所有注册必须走 `ctx.effect()`、`ctx.on()` 或返回 disposer 的 registry API，插件卸载后不能残留 Remote、slot、tool 或 prompt section。
- 新的 model-visible 信息必须先进入 Session 日志，再从日志生成模型请求；不能从 mutable UI store 直接注入隐藏上下文。
- 新 Session 事件默认 required-on-read。事件 schema 或 envelope 策略必须遵守 Session format 规则，不能随意标 `ignorable`。
- 跨包 id 使用 branded types，不要退回裸 string。
- durable/file/tool/wire 输入需要运行时校验；同进程 TypeScript 已保证的值不要重复做敌意校验。
- 任何 UI mutation 都传精确 `ArticleRef` 或图片等价 CAS ref；Remote 返回 stale 时刷新 Projection 并让用户重试，不做 last-write-wins。
- `article/document` 是 append-only；不要“修复”历史事件或覆盖 Markdown 内容。
- 子 Session fork 包含父历史。任何 parent-owned request、workspace path 或 action 都必须按当前 branch 归属过滤。
- 文章树从 Session Projection 与 parent ids 重建，不新增全局树数据库。
- 生成目录的英文文档、Cordis API catalog 和 graph 不手改；修改 owner 后重新运行生成器，再更新中文 counterpart 和 sidecar。
- 新用户可见行为必须增加真实 runnable keyless snapshot；mock-only package test 不足以满足仓库验收。
- 不要修改 `vendor/`。

## 完成定义

只有满足以下全部条件，才能把 requirements log 从 partially complete 改为 complete：

- 可选 Bundle 在真实 Harness Web profile 中加载，Dock 稳定出现并可卸载。
- 根文章从素材到草稿、配图规划、人工审核循环、终稿、正式图片全流程可操作。
- 任意阶段可创建关联新 Session 的独立子分支，至少三层树在重启后可恢复和双向导航。
- 每个分支可独立同步 Markdown、检测冲突、查看版本、退回历史 draft、改图和选择历史图片。
- 父、子、兄弟分支之间不存在自动合并、文件覆盖、图片选择串扰或任务串扰。
- running-turn 保存想法、fork 边界、创建失败、cold retry、取消关联都有真实测试和 UI 恢复路径。
- package tests、keyless assembled snapshot、GUI tests、typecheck、lint、build、hygiene、doc-sync 和 diff check 都有当前工作区的通过证据。
- Agent Note、requirements log、package READMEs、article subsystem、tool/config/persistence/event catalogs 和中英文配对与最终行为一致。

## 建议给新 Agent 的开场指令

```text
继续开发 /Users/wzp/Documents/GitHub/deepseek-harness 的原生文章树工作台。

先完整读取：
1. .agents/handoffs/article-tree-workbench.md
2. .agents/notes/implemented/feature/2026-08-29-article-tree-workbench.md
3. docs/requirements-log.md 的 REQ-2026-001
4. docs/architecture.md、AGENTS.md、docs/AGENTS.md

然后检查 git status，不得清理、重置或覆盖当前未提交改动。先执行 handoff 的 M0，把 doc-sync、typecheck、focused tests、lint、build、hygiene 和 git diff --check 收口。不要先做生图。

M0 通过后，优先完成真实人工审核闭环：review.md、结构化批准/打回、按意见改稿后返回 review、批准后才生成 final，并补 control/workspace/tool 测试。之后按 M2-M6 继续，最终实现分支隔离的配图规划、生图、改图和图片版本回退。任何分支都不能自动合并或覆盖父分支。
```
