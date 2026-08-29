# article/ — 文章树工作台

[English](README.md) | 中文

article 子系统把一个普通 Harness Session 变成一条可独立编辑的文章分支，并通过普通 Session fork 谱系把相关分支连成一棵文章树。根文章是一条没有父分支的分支；每条子分支都拥有自己的对话、Markdown 文件、不可变版本和回退历史。

| Package | Role | ctx key |
|---|---|---|
| [`article/`](article/README.md) | 事件溯源的文章分支、文档版本、分支请求和投影 | `ctx.articles` |
| [`article-workspace/`](article-workspace/README.md) | 分支本地 Markdown 工作副本和冲突检查 | `ctx.articleWorkspace` |
| [`article-control/`](article-control/README.md) | 人工工作流控制、回退和可恢复 Session 分支 | `ctx.articleControl` |
| [`tool-article/`](tool-article/README.md) | 面向模型的文章读写工具 | — |

Web 界面是 [`client/ui-article`](../client/ui-article/README.md)。加载完整工作台的可安装 patch layer 是 [`bundle/article-workbench`](../bundle/article-workbench/README.md)。
