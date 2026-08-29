# @deepseek-ai/dsh-client-ui-article

[English](README.md) | 中文

浏览器文章控制面板。该插件在 order 15 注册一个 `conversation.input.dock` 卡片，读取 live `article` Session projection，并通过 `article-control` Remote 方法执行人工工作流动作。

## Surface

当当前对话还没有文章时，dock 渲染根文章创建表单。分支存在后，它显示文章标题、分支路径、阶段轨道、当前 revision、文档动作、回退选择器、子分支表单、已保存/失败分支请求的恢复控制，以及紧凑的递归分支树。点击树节点会打开该分支对应的普通 Harness Session。

UI 不持有自己的 article store。它对按钮动作做 single-flight，在点击时通过 session projection face 读取当前 CAS ref，并内联报告 Remote 失败。

## Model Experience

### Human control surface

#### What the model sees

面板自身不增加 prompt 内容。它的按钮调用 `article-control` Remote 方法；只有控制器刻意排入 workflow followup 的动作（例如 idea-to-draft 或 review-to-final）才会成为模型可见消息。

#### Token effect

渲染面板本身没有 token 成本。token 使用来自 Remote action 下游控制器行为，而不是浏览器卡片。

#### KV Cache effect

渲染面板本身没有 KV-cache 影响。排队的 workflow followup 会追加在既有历史之后，并遵循控制器的 cache 行为。

## Known Limitations and Deferred Work

- **当前树数据来自已加载 Session summaries** —— 没有 article projection summary 的冷 Session 不会显示，直到它的 summary 可用。
- **没有自动合并 UI** —— 分支节点只负责导航，不合并内容。
- **暂未提供图片控制** —— 第一版面板覆盖文本工作流、回退和分支导航。
