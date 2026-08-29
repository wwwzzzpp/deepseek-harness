# 需求完成台账

[English](requirements-log.md) | 中文

本文件记录已经进入开发流程的产品需求及其实际交付状态。计划不等于完成；状态以实现和验证证据为准。

## 总览

| ID | 需求 | 状态 | 完成日期 | 相关模块 |
| --- | --- | --- | --- | --- |
| REQ-2026-001 | DeepSeek Harness 原生文章树工作台 | 部分完成 | 2026-08-29 | `packages/article/`, `packages/client/ui-article/`, `packages/bundle/article-workbench/` |

## 需求记录

### REQ-2026-001 DeepSeek Harness 原生文章树工作台

- 状态：部分完成
- 提出日期：2026-08-29
- 完成日期：2026-08-29
- 用户目标：把个人写作发布系统迁移为 DeepSeek Harness 的原生插件能力，在聊天界面内控制文章从选题到终稿的流程，并允许从任一步骤创建关联新对话的独立文章分支。
- 交付结果：已实现第一版原生文章树工作台。用户可以在对话输入区 Dock 创建根文章，推进选题、草稿、审核和终稿状态，打开和同步当前分支的 Markdown 工作副本，在当前分支内退回草稿或历史草稿，并从当前阶段创建新的子分支对话。每个分支拥有自己的 Session、文章状态、文档版本、Markdown 目录和回退历史；子分支不会自动合并或覆盖父分支。
- 实现方式：系统把文章状态写入 Session 日志，再由 article Projection 还原当前分支状态。控制面板只调用 article-control 的 Remote 方法推进流程、回退和创建分支；模型只能通过 article 工具读取和写入当前分支文档。Markdown 文件由 article-workspace 在 `.dsh/article/<tree-id>/<branch-id>/` 下生成和同步，外部编辑会被导入为新的人工版本，未同步的脏文件会阻止覆盖。创建分支时，article-control 使用 Harness 的 Session fork 机制创建子对话，把父分支当时的文档复制为子分支自己的初始版本，并把用户保存的新想法作为子对话消息发送。
- 验收标准：
  - [x] 加载 bundle 后存在文章工作台插件栈和 Dock 控制面板入口。
  - [x] 根分支可以创建并推进选题、草稿、审核、终稿状态。
  - [x] 文档版本不可变，回退只选择当前分支的草稿版本，不删除旧终稿。
  - [x] Markdown 文件按文章树和分支隔离，未同步外部修改不会被覆盖。
  - [x] 从当前分支创建子分支时生成独立 Session、独立分支 id、独立文档复制版本和独立 Markdown 目录。
  - [x] Agent 运行中创建分支会先保存想法，等待当前轮次完成后再确认创建。
  - [x] 分支创建失败记录可恢复状态，并保留已经创建的子 Session id。
  - [x] 分支树从 Session Projection 重建，不新增全局文章树数据库。
  - [x] 子分支不会通过文章插件自动合并或覆盖父分支。
  - [ ] 生图、改图和图片版本工作流尚未实现；后续需要按同样的分支隔离规则接入 Harness attachments 和 jobs。
  - [ ] Keyless Web Snapshot、完整 GUI 测试和真实浏览器交互验收尚未补齐。
- 验证证据：`pnpm exec vitest run packages/article/article/tests/fold.spec.ts packages/article/article/tests/service.spec.ts` 通过；`pnpm run typecheck` 通过；`pnpm run gen-tool-catalog` 已重新生成工具目录。
- 实现位置：`packages/article/article/`, `packages/article/article-workspace/`, `packages/article/article-control/`, `packages/article/tool-article/`, `packages/client/ui-article/`, `packages/bundle/article-workbench/`, `docs/tool-catalog.md`, `.agents/notes/implemented/feature/2026-08-29-article-tree-workbench.md`。
- 关联需求：无。
- 后续事项：补齐图片生成和改图的分支隔离工作流；增加 UI 交互测试、Keyless Web Snapshot 和失败恢复场景的端到端覆盖。
