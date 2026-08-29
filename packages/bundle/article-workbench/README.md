# @deepseek-ai/dsh-article-workbench

English | [中文](README.zh.md)

Installable Web-profile patch layer for the article workbench. The bundle mounts article state, Markdown workspaces, human controls, model tools, and the browser dock without changing the default `@deepseek-ai/dsh-web-app` bundle.

## Patch rows

`cordis.patch.yml` inserts `article`, `article-workspace`, `article-control`, `tool-article`, and `ui-article`. The domain and controller rows live in the host plane. `tool-article` is intentionally mounted as a global tool row for this bundle: loading the article workbench makes article read/write tools available to agents, while the tools still fence writes to the current Session's branch.

## Model Experience

### Bundle-mounted article workflow

#### What the model sees

When this patch layer is loaded, agents can see the `tool:article` prompt section and the `article_read_current`/`article_write` schemas from `@deepseek-ai/dsh-tool-article`. Workflow buttons may also queue controller-authored `<article_workflow>` messages.

#### Token effect

The bundle adds the article tool prompt and schema costs to agents in scope. Additional tokens appear only when a workflow followup is queued or a tool result includes current Markdown.

#### KV Cache effect

The bundle's prompt and schema additions are prefix-stable while the patch layer and tool config remain unchanged. Branch creation uses ordinary Session fork history and then appends the branch idea in the child Session.

## Known Limitations and Deferred Work

- **Web-profile oriented** — the bundle expects the Web host API and browser client roster to be present.
- **Global article tool visibility** — loading this bundle exposes article tools to every agent in the process; execution remains branch-local.
- **No image workflow rows yet** — future image generation/editing rows must preserve the same branch isolation.
