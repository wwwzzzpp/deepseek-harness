# @deepseek-ai/dsh-client-ui-article

English | [中文](README.zh.md)

Browser article control panel. The plugin registers one `conversation.input.dock` card at order 15, reads the live `article` Session projection, and invokes `article-control` Remote methods for human workflow actions.

## Surface

The dock renders a root creation form when no article exists. Once a branch exists, it shows the article title, branch path, stage rail, current revision, document actions, rollback picker, child-branch form, saved/failed branch-request recovery controls, and a compact recursive branch tree. Clicking a tree node opens that branch's ordinary Harness Session.

The UI owns no article store. It single-flights button actions, reads the current CAS ref at click time through the session projection face, and reports Remote failures inline.

## Model Experience

### Human control surface

#### What the model sees

The panel itself adds no prompt content. Its buttons call `article-control` Remote methods; only those controller actions that intentionally queue workflow followups, such as idea-to-draft or review-to-final, become model-visible messages.

#### Token effect

None from rendering the panel. Token use comes from the Remote action's downstream controller behavior, not from the browser card.

#### KV Cache effect

None from rendering the panel. Queued workflow followups append after existing history and follow the controller's cache behavior.

## Known Limitations and Deferred Work

- **Current tree data comes from loaded Session summaries** — cold Sessions without an article projection summary are not shown until their summary is available.
- **No automatic merge UI** — branch nodes navigate only; they do not merge content.
- **No image controls yet** — the first panel covers text workflow, rollback, and branch navigation.
