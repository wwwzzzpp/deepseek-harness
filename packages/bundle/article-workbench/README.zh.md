# @deepseek-ai/dsh-article-workbench

[English](README.md) | 中文

面向 Web profile 的可安装文章工作台 patch layer。该 bundle 挂载文章状态、Markdown 工作副本、人工控制、模型工具和浏览器 dock，不改变默认 `@deepseek-ai/dsh-web-app` bundle。

## Patch rows

`cordis.patch.yml` 插入 `article`、`article-workspace`、`article-control`、`tool-article` 和 `ui-article`。领域和控制器行位于 host plane。`tool-article` 被有意作为该 bundle 的全局 tool row 挂载：加载文章工作台后，agent 可以使用文章读写工具，而工具仍会把写入限制在当前 Session 的分支内。

## Model Experience

### Bundle-mounted article workflow

#### What the model sees

加载该 patch layer 后，agent 可以看到来自 `@deepseek-ai/dsh-tool-article` 的 `tool:article` prompt section，以及 `article_read_current`/`article_write` schemas。工作流按钮也可能排入控制器作者身份的 `<article_workflow>` 消息。

#### Token effect

该 bundle 会给作用域内 agent 增加文章工具 prompt 和 schema 成本。只有排入 workflow followup 或工具结果包含当前 Markdown 时，才会出现额外 token。

#### KV Cache effect

只要 patch layer 和工具 config 不变，bundle 增加的 prompt 和 schema 对 prefix 是稳定的。分支创建使用普通 Session fork 历史，然后在子 Session 中追加分支想法。

## Known Limitations and Deferred Work

- **面向 Web profile** —— 该 bundle 预期已有 Web host API 和 browser client roster。
- **文章工具全局可见** —— 加载该 bundle 会把文章工具暴露给进程内每个 agent；执行仍保持分支本地。
- **暂未提供图片工作流 rows** —— 未来生图/改图 rows 必须保持同样的分支隔离。
