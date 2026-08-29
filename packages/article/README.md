# article/ — article-tree workbench

English | [中文](README.zh.md)

The article subsystem turns an ordinary Harness Session into one independently editable article branch, and ties related branches into one article tree through normal Session fork lineage. The root article is a branch without a parent; every child branch owns its own conversation, Markdown files, immutable revisions, and rollback history.

| Package | Role | ctx key |
|---|---|---|
| [`article/`](article/README.md) | Event-sourced article branches, document revisions, branch requests, and projections | `ctx.articles` |
| [`article-workspace/`](article-workspace/README.md) | Branch-local Markdown working copies and conflict checks | `ctx.articleWorkspace` |
| [`article-control/`](article-control/README.md) | Human workflow controls, rollback, and recoverable Session branching | `ctx.articleControl` |
| [`tool-article/`](tool-article/README.md) | Model-facing article read/write tools | — |

The Web surface is [`client/ui-article`](../client/ui-article/README.md). The installable patch layer that loads the whole workbench is [`bundle/article-workbench`](../bundle/article-workbench/README.md).
