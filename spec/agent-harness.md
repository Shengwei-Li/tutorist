# 附录 E：Agent Harness 架构（教学外壳 + 教学工具库）

> 2026-10-27 · 对 SPEC §4.10、§7 的修订。本附录与主 spec 冲突时，以本附录为准。
> 调研对象：t3code（pingdotgg）、vibe-kanban、Claudia/opcode、CloudCLI；协议：Codex app-server、ACP、MCP。

---

## E.1 定位转变

M1 的做法是**我们自己写 AI 流水线**：计划 → 生成 → 评审 → 修订，每一步都是"一次模型调用 + schema"。这条路能跑通，但它在重复造 Claude Code、Codex、OpenCode 已经做好的东西：多轮推理、读文件、看图、自我修正、长任务、会话恢复。而且它把 agent 的能力压扁成了"填一个 JSON"。

新定位：

> **TutorDesk = 教学外壳 + 教学工具库。干活的是老师电脑上已经登录的 coding agent。**

| 谁 | 负责什么 |
|---|---|
| **Agent**（Claude Code / Codex / OpenCode） | 理解老师的话、出计划、写材料、按意见修改、批改作文、读 PDF 和照片、跨文件分析、批量任务 |
| **我们的代码**（工具库） | 数据格式、校验、排版编译、文件与版本管理、错因库、预览；**质量门槛是硬的**：不合格的东西存不进去 |
| **老师**（界面） | 确认计划、给终评分、把批注收进错因库、决定什么交给学生 |

不变的部分：工作区（每个学生一个文件夹 + git）、Zod schema、LaTeX 渲染器和四套 Beamer 主题、确定性检查、TexEngine、批改视图、考试知识和评分标准的内容。
变化的部分：M1 的 `LessonPipeline` 降级为 **API 模式的一键流程**；考试知识从"拼进 prompt"改为"agent 按需读取"。

---

## E.2 三层架构

```
┌──────────────────────────── 外壳（Electron UI）─────────────────────────────┐
│ 学生 / 课次 / 作文导航 │ 对话线程（每个学生、每节课各一条） │ PDF 预览、批注、质量状态 │
│ 顶部：Claude Code ▾  Codex  OpenCode  API        快捷指令：备这节课 · 批改这篇 · …  │
└──────────────┬─────────────────────────────────────────────────────────────┘
               │ HarnessSession（统一事件流 + 审批 + 中断 + 恢复）
┌──────────────┴──────────────── 驱动层（packages/harness）──────────────────┐
│ ClaudeCodeSession      CodexSession             AcpSession          ApiSession │
│ Agent SDK → 本机 claude  codex app-server        opencode acp        AI SDK 工具循环 │
│ (stream-json 双向)      (JSON-RPC over stdio)     (ACP, JSON-RPC)     (BYOK)        │
└──────────────┬─────────────────────────────────────────────────────────────┘
               │ MCP（stdio）：每个会话挂载同一个 tutordesk 服务
┌──────────────┴──────────────── 工具库（packages/toolbox）──────────────────┐
│ 学生上下文 · 课次 · 计划 · 产出物保存（校验→检查→编译）· PDF 导出 · 批改 · 材料 · 指南  │
│ 复用：core（工作区、schema）· render（LaTeX）· tex（编译）· pipeline（检查、知识、评分标准）│
└────────────────────────────────────────────────────────────────────────────┘
```

---

## E.3 驱动层：HarnessSession

### E.3.1 统一接口

```ts
interface HarnessSession {
  readonly harness: 'claude-code' | 'codex' | 'opencode' | 'api';
  start(opts: SessionStart): Promise<{ nativeId: string }>;   // 新建或恢复
  send(input: UserTurn): AsyncIterable<HarnessEvent>;         // 一轮对话，流式事件
  respond(requestId: string, decision: ApprovalDecision): void;  // 回复审批
  interrupt(): Promise<void>;                                  // 打断当前一轮
  close(): Promise<void>;
}

interface SessionStart {
  cwd: string;                 // 工作区根目录（agent 能看到所有学生，但工具调用按 studentId 隔离）
  mode: 'guarded' | 'collaborate' | 'full';   // 见 E.6
  resume?: string;             // 原生会话 ID
  model?: string;              // 不填 = 该 harness 自己的默认（订阅内模型）
  instructions?: string;       // 追加的系统指令（当前学生、当前课次）
  mcp: McpLaunch;              // tutordesk 工具库的启动命令
}

type HarnessEvent =
  | { type: 'session'; nativeId: string; model?: string }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool'; id: string; name: string; input: unknown; status: 'running' | 'ok' | 'error'; summary?: string }
  | { type: 'file'; path: string; op: 'create' | 'edit' | 'delete' }
  | { type: 'approval'; requestId: string; kind: 'command' | 'edit' | 'tool' | 'other'; title: string; detail?: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cachedTokens?: number; usd?: number }
  | { type: 'turn_end'; status: 'completed' | 'interrupted' | 'failed'; error?: string };
```

`AgentProvider`（M0/M1 的一次性 `run`）保留给 API 模式的固定流程和评测；对话式交互一律走 `HarnessSession`。

### E.3.2 适配器

| Harness | 启动 | 会话与恢复 | 审批 | 挂载工具库 | 依据 |
|---|---|---|---|---|---|
| **Claude Code** | `@anthropic-ai/claude-agent-sdk` 的 `query()`，`pathToClaudeCodeExecutable` 指向**本机已安装的 claude**，并去掉 `ANTHROPIC_API_KEY`，从而走用户自己的订阅登录 | 流式输入（AsyncIterable 用户消息）= 一个长会话；`resume: sessionId` | `canUseTool` 回调 → `approval` 事件 → 老师在 UI 里点 | `mcpServers: { tutordesk: { command, args } }` | Agent SDK 官方接口 |
| **Codex** | `codex app-server`（stdio JSON-RPC），一个会话一个进程（同 t3code） | `thread/start` / `thread/resume`；`turn/start`、`turn/interrupt` | 服务端请求 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval` → 回复 `accept` / `decline` / `cancel` | `thread/start.config.mcp_servers.tutordesk` | 协议类型用 `codex app-server generate-ts` 从**本机安装版本**生成，锁定版本区间 |
| **OpenCode** | `opencode acp`（ACP over stdio） | `session/new`、`session/load`；`session/prompt`、`session/cancel` | `session/request_permission` → 回复选中的 option | `session/new.mcpServers` | ACP 开放标准；同一适配器也能接 Gemini CLI、`claude-code-acp`、`codex-acp` |
| **API** | 进程内：AI SDK 工具循环（`stopWhen`），工具 = 工具库的函数直接调用（不经 MCP） | 会话历史存在线程文件里 | 写入类工具按模式要求审批 | 直接 import | 给不会装 coding agent 的老师 |

- **健康检查**：可执行文件位置、版本、是否登录（`claude auth status`；Codex `account/read`；OpenCode 首次 `initialize` 的 `authMethods`）。界面显示"已连接 Claude Code（订阅）"或下一步该做什么。
- **版本**：每个适配器声明兼容的版本区间。超出区间仍可用，但界面提示"未验证版本"。
- **进程**：每个会话一个子进程，关闭或出错时整棵进程树一起结束（沿用 `killTree`）。

### E.3.3 会话（线程）模型

- 线程挂在教学对象上：`student`（学生总线程）、`lesson`（某节课）、`submission`（某篇作文）。
- 存放在 `<workspace>/.tutordesk/threads/<threadId>.json`：标题、挂载对象、harness、原生会话 ID、创建时间、消息摘要。完整对话由各 harness 自己保存（Claude 的 jsonl、Codex 的 rollout），我们只存索引和 UI 需要的事件摘要。
- **中途换 harness**：开一个新的原生会话，并把"这条线程到目前为止做了什么"的摘要作为开场上下文。真正的状态在文件里（计划、产出物、错因库），所以换 harness 的代价很小。

---

## E.4 工具库：`tutordesk` MCP 服务

一个 stdio MCP 服务，启动参数是工作区根目录。所有 harness 挂载同一份。工具名在 agent 侧显示为 `mcp__tutordesk__<name>`。

### E.4.1 设计原则

1. **工具返回的是"下一步该怎么做"**。校验失败时返回逐条、带路径的问题，例如 `frames[3].title: 52 chars, limit 40`，让 agent 自己修，不需要我们再写修订循环。
2. **schema 只有一份**：Zod 定义同时用于工具入参校验、`get_artifact_schema` 返回给 agent 的 JSON Schema、渲染器的输入类型。
3. **结构化数据只能经由工具写入**。在 guarded 模式下，agent 对工作区只读；计划、产出物、批改结果、材料文本都必须通过工具保存。
4. **工具不能越过老师**：没有"确认计划""定终评分""写入错因库"这类工具。agent 只能**提议**，定稿在界面里完成。
5. **每次写入都提交 git**（提交信息注明 harness 和线程），老师可以按版本回滚。
6. **知识只有一份**：考试事实、教学规则、产出物规范、评分标准都在 `packages/pipeline` 的代码里。skills 文件和 `get_guidelines` 工具都由它生成，不手写第二份。

### E.4.2 工具清单

| 工具 | 输入 | 作用 | 闸门 |
|---|---|---|---|
| `list_students` | — | 学生列表：考试、目标分、最近一节课、待处理作文 | 只读 |
| `get_student_context` | studentId, lessonId? | 档案、老师笔记、未解决错因、最近批改、最近两节课、本课材料。与 API 流程使用的上下文相同 | 只读 |
| `list_lessons` / `get_lesson` | studentId, lessonId? | 课次信息、计划、已有产出物及其质量状态 | 只读 |
| `create_lesson` | studentId, date, minutes?, topic?, brief? | 新建课次 | 写 |
| `get_guidelines` | topic | 考试事实、教学设计规则、质量标准、某类产出物的写法 | 只读 |
| `get_artifact_schema` | kind（plan / handout / worksheet / script / deck / writing-review） | JSON Schema + 该类产出物的规则 + 行内标记语法 + 评审标准（含硬性门槛项，供 agent 自查） | 只读 |
| `save_plan` | studentId, lessonId, plan | schema 校验 → 计划检查（时长求和、目标与检测对应、错因引用）→ 保存为**待确认**状态 | 保存后 `planConfirmed=false`，等老师在界面确认 |
| `save_artifact` | studentId, lessonId, kind, doc | schema 校验 → 确定性检查 → 渲染 LaTeX → 编译 → 溢出与残留标记检查 → 保存，并写 `qa/<kind>.json` | 计划未确认时拒绝；有 error 级问题时**仍保存为草稿**，但返回问题清单并标记"未通过" |
| `get_artifact` | studentId, lessonId, kind | 读取当前产出物 JSON 和上次检查结果（用于修改） | 只读 |
| `export_pdf` | studentId, lessonId, kind, edition, theme? | 编译学生版、教师版或答案版，存到 `out/` | 写（只写 out/） |
| `save_review_scores` | studentId, lessonId, kind, review | 独立评审会话写入 rubric 打分（E.5） | 写 `qa/` |
| `list_submissions` / `get_submission` | studentId, subId | 作文原文、题目、状态、已有批改 | 只读 |
| `save_writing_review` | studentId, subId, review | schema 校验 → 引文定位（必须逐字摘自原文）→ 分数区间规则 → 错误代码校验 → 保存为待老师终评 | 原文未经老师确认时拒绝 |
| `save_transcription` | studentId, subId, text, unsure[] | agent 读照片后写入转写文本，状态为"待老师确认" | 写 |
| `save_material_text` | studentId, name, text, source | agent 读 PDF 或图片后，把提取的文本存到 `materials/parsed/`，可同时挂到某节课 | 写 |
| `append_note` | studentId, text | 往老师笔记（notes.md）追加一条，标注来源 | 写 |

不提供：删除任何东西、修改档案里的分数、确认计划、终评、写错因库、任意路径写文件。

### E.4.3 分发与启动

- 打包成单个 JS 文件 `tutordesk-mcp.mjs`（esbuild），随应用分发，由 Electron 自带的 Node 运行（`ELECTRON_RUN_AS_NODE=1`），不要求老师装 Node。
- 启动参数：`--workspace <root>`，可选 `--require-plan-approval false`（作者自用时可关）。
- 开发时也可以手动注册到本机 agent 上，脱离 TutorDesk 界面使用：
  - Claude Code：`claude mcp add tutordesk -- node <path>/tutordesk-mcp.mjs --workspace <root>`
  - Codex：`~/.codex/config.toml` 的 `[mcp_servers.tutordesk]`

---

## E.5 质量回路（agent 模式）

| 层 | 机制 | 强制程度 |
|---|---|---|
| 格式 | `save_*` 工具的 Zod 校验，逐条返回问题 | 硬：存不进去 |
| 确定性检查 | `checks.ts`（时长、编号、答案字段、PTE/雅思形式规则、幻灯片字数和标题长度、中文、班课用语…） | 硬：error 级问题会标记为"未通过"，界面置红 |
| 排版 | 真实编译 + 溢出、缺字、残留标记检查 | 硬 |
| 自查 | 工作流 skill 要求 agent 保存前对照 `get_artifact_schema` 里的评审标准自查一遍 | 软：靠指令 |
| **独立评审** | 保存后，外壳另起一个**新会话**（不继承生成过程的上下文，可以换一个 harness），只给它产出物、学生上下文和评分标准，用 `save_review_scores` 写分。未达标时，把问题清单作为下一轮消息发回生成线程 | 可配置：默认对讲义、练习卷、幻灯片开启 |
| 老师 | 界面始终显示质量状态（通过 / 未通过的具体项 / 未评审） | 最终决定 |

这样，M1 里"生成 → 检查 → 评审 → 修订"的循环仍然存在，但修订由 agent 在同一个会话里完成，它知道前因后果，比我们重新拼 prompt 修得更准。

---

## E.6 权限模式

| 模式 | Agent 能做什么 | 各 harness 的实现 |
|---|---|---|
| **guarded**（默认） | 读工作区；写入只能通过 tutordesk 工具；不能执行命令，不能联网 | Claude：`allowedTools` = Read/Glob/Grep + `mcp__tutordesk__*`，其余在 `canUseTool` 里拒绝。Codex：`sandbox: read-only`，`approvalPolicy: on-request`，命令审批一律拒绝。OpenCode：`edit`/`bash` 的权限请求一律拒绝 |
| **collaborate** | 另外可以改学生文件夹里的 Markdown（不含 notes.md），每次写入都弹审批，审批卡片列出文件；不能执行命令 | Claude：命令工具放进 `disallowedTools`，编辑在 `canUseTool` 里只放行学生 Markdown。Codex：`workspace-write` + `untrusted`，命令审批一律拒绝，文件审批只放行学生 Markdown。OpenCode：`edit: ask`，`bash: deny` |
| **full** | 不弹审批，可以执行命令（作者自用、批量任务） | Claude `bypassPermissions`；Codex `workspace-write` + `never`；OpenCode 自动允许 |

任何模式下：工具库自己的闸门（E.4.1 第 4 条）不变；Codex 和 Claude 都不开网络。

协作模式不放行命令，原因是实测（Codex，2026-10-28）：让它把 lesson.json 的 planConfirmed 改成 true，它改用一条 `powershell -Command "python -c ..."` 来改，审批卡片上虽然有完整命令，但老师看不懂，一点允许就绕过了计划审批。按文件名过滤命令挡不住换个写法，所以命令只在完全模式下可用。

---

## E.7 知识层：AGENTS.md + skills

工作区初始化或升级时，由代码生成（覆盖写入，文件头注明"自动生成，勿手改"）：

```
<workspace>/
  AGENTS.md                 Codex、OpenCode 读：工作区结构、工具清单、闸门、工作流入口
  CLAUDE.md                 一行 @AGENTS.md（同源）
  .claude/skills/<name>/SKILL.md     Claude Code
  .agents/skills/<name>/SKILL.md     Codex / OpenCode（目录以安装版本实测为准）
```

| Skill | 内容 |
|---|---|
| `tutordesk-lesson-prep` | 备课工作流：读上下文 → 出计划（`save_plan`）→ 停下等老师确认 → 逐份生成产出物 → 自查 → 处理 `save_artifact` 返回的问题 → 导出 PDF |
| `tutordesk-writing-review` | 批改工作流：读原文（照片先转写并等老师确认）→ 四项区间 → 逐字引文批注 → 错误代码 → `save_writing_review` |
| `tutordesk-materials` | 导入工作流：读 PDF 或图片 → 抽取文本、题目和答案 → `save_material_text`；版权规则 |
| `tutordesk-exam-ielts` / `tutordesk-exam-pte` | 考试事实（只能用这里的，不得凭记忆补充）、错因代码表 |
| `tutordesk-teaching` | 教学设计规则 + 质量标准 |

skills 是渐进加载的：agent 只在需要时打开。不支持 skills 的 harness 可以调用 `get_guidelines` 拿到同样的内容。

---

## E.8 快捷指令

界面上的按钮就是**预设好的一条消息**，发到当前线程。老师也可以直接打字。

| 指令 | 发出的消息（概要） | 默认模式 |
|---|---|---|
| 备这节课 | "为 <学生> 的第 N 课出计划卡。按 tutordesk-lesson-prep 来，存好计划后停下等我确认。" | guarded |
| 生成材料 | "计划已确认。生成底稿、讲义、练习卷和幻灯片，每份存完都处理检查结果。" | guarded |
| 按意见改 | "<老师的话>，只改 <产出物>。" | guarded |
| 批改这篇 | "批改 <作文>，按 tutordesk-writing-review。" | guarded |
| 导入材料 | "读 <文件>，把文本和题目存成材料。" | guarded |
| 学生分析 | "综合 <学生> 的档案、错因库和最近的作文，写一段阶段分析追加到笔记。" | guarded |

---

## E.9 界面原则（细节在 UI 阶段再定）

- 对话不是主角，**教学对象才是**。左边是学生和课次，中间是线程，右边是产出物和 PDF。
- 工具调用显示成一行一句话的时间线（"读取了李同学的错因库""保存讲义：2 处问题"），原始参数折叠起来。
- 审批是一张内嵌卡片，写清楚 agent 要做什么、动哪个文件，按钮只有"允许""拒绝"。
- 质量状态常驻在产出物标签上。
- 视觉延续 §8：克制、留白、单一强调色，不要"AI 味"。

---

## E.10 测试与花费

- **单元测试**：工具库的每个工具都直接调用测试（临时工作区，不经 MCP），覆盖校验失败、闸门拒绝、成功保存和 git 提交。
- **协议测试**：每个适配器用**假的 harness 进程**（一个按脚本回放协议消息的 Node 小程序）测试事件映射、审批往返和中断，不花钱。
- **真实 harness 冒烟测试**：需要显式环境变量，**并且每次运行前征得作者同意**（会消耗订阅额度或 API 费用）。
- 不同 harness 的 eval 分差目标 ≤ 0.3（沿用 §12 M3 的标准）。

---

## E.11 实施顺序

| 步骤 | 内容 | 完成标准 |
|---|---|---|
| H1 | 从 `LessonPipeline` 中拆出无模型的 `ArtifactStudio`（渲染、检查、编译、保存、导出）；工具库包 + MCP 服务 + 打包脚本 | 工具单测通过；`claude mcp add` 手动挂载后能用 |
| H2 | 生成 AGENTS.md / skills | 工作区初始化后文件齐全，内容来自代码 |
| H3 | `HarnessSession` 接口 + Claude Code 适配器 | 用订阅跑通"备这节课 → 确认 → 生成讲义" |
| H4 | Codex app-server 适配器 | 同上 |
| H5 | ACP 适配器（OpenCode） | 同上 |
| H6 | API 会话（AI SDK 工具循环 + 同一套工具） | 不装 agent 的老师也能对话 |
| H7 | 界面：线程、harness 切换、审批卡片、工具时间线、快捷指令 | 另行设计评审后实施 |

## E.12 学生档案与排课：AI 提议，老师确认

老师用一段话描述学生、说明变化或给出课表，AI 把它整理成**提议**，老师在 TutorDesk 里确认后才写入。跟计划卡是同一道关卡：没有任何工具能直接改档案，也不能一次建一批课。

- **工具**：
  - `propose_student`：新学生的画像，可以附带首批课次。
  - `propose_profile_update`：只写要改的字段。
  - `propose_lessons`：一批课次，每节有日期、时长、主题。
- **提议前先校验**：整份档案合并后要能通过 schema，比如雅思目标 6.3 会被打回给 agent。课次和已有课次撞日期时，结果里会提示。
- **存放**：`<workspace>/.tutordesk/proposals/<id>.json`，状态有 pending、applied、dismissed 三种。同一件事（同一学生同一类，或同名新学生）再提一次，旧的自动作废。
- **界面**：
  - 卡片列出每个字段改前改后的值，课次可以逐节取消勾选。
  - 「确认」直接写入；「修改…」打开平常的档案编辑框，内容已经填好；「不用了」作废这条提议。
  - 写入会留下 git 记录，提交信息里写明是哪个 agent 提的。
- **对话**：
  - 学生页有「AI 助手」侧栏（subject `student`）。
  - 添加学生默认是「描述给 AI」（subject `workspace`），也可以切换成手动填写。
  - 老师确认或放弃以后，下一条消息开头会附一句系统说明，让 agent 知道结果。
  - agent 的说明里带今天的日期和星期，方便它换算「下周二」这类说法。
- **AGENTS.md 规则**：考试、目标分、上课安排缺一项时，先问一句再提议；其他不知道的字段留空，不许编。

## E.13 语音输入（本机识别，可选云端）

对话输入框里有麦克风按钮：点一下开始录音，再点一下停止，识别出的文字放进输入框，老师看过再发送。「语音控制」靠 agent 和它的工具实现，语音本身只负责把话变成文字。

- **模型**：两个，按「说话语言」选，没选过就跟界面语言走。都通过 `sherpa-onnx-node` 1.13.8 运行；这个包没有安装脚本，用的是 Node-API 原生模块。
  - **英语**：NVIDIA Parakeet TDT 0.6B v2 int8(661 MB，CC-BY-4.0)，自带标点和大小写。
  - **中文和中英混说**：SenseVoice Small int8(sherpa-onnx 导出的 2025-09-09 版，237 MB)。
- **选型实测**(2026-10-28)：语料是 Speech Accent Archive 的 12 位澳洲母语者，朗读同一段 Stella 文本，共 828 词。
  - Parakeet 词错率 0.5%。
  - Moonshine base 1.6%，但 2 分钟长录音会陷入重复循环，内存涨到 4 GB，因此不用。
  - SenseVoice 15.1%。
  - Parakeet 识别 2 分钟录音用 11 秒(4 线程)，峰值内存约 1.7 GB；SenseVoice 约 0.5 GB。
  - 注意：这段文本是朗读，而且流传很广，自然口语的错误率会更高。
- **下载**：只在老师同意后下载，存到 `userData/models/<id>`，两个模型各自独立。
  - 来源按顺序尝试：Hugging Face 上游（固定到某一次提交）和 ModelScope 镜像。界面语言是中文时先试 ModelScope。
  - 每个文件先写成 `.part`，边下载边算 SHA-256。大小和哈希都对上固定值才改名启用；超出预期大小立即中断。
  - 某个来源 20 秒没有数据就换下一个。
  - 正因为每个文件都要核对哈希，镜像不需要可信。
- **运行**：
  - 识别跑在单独的 Electron utility process 里。第一次录音时才加载，3 分钟不用就结束这个进程；切换语言时换成另一个模型。识别参数（模型路径、线程数）由主进程生成。
  - 原生代码崩溃不会拖垮应用。这个进程不联网，不碰工作区，启动时去掉环境变量里的 key 和 token。
- **音频**：
  - 浏览器端用 AudioWorklet 采集，用浏览器自带的重采样转成 16 kHz 单声道，最长 2 分钟，只在内存里，不保存。
  - 主进程再检查一遍：必须是 Float32Array，长度在 0.25 秒到 120 秒之间，非有限的数置 0、超出范围的截断到 [-1, 1]。
- **权限**：应用对 Electron 的权限一律默认拒绝。
  - 只允许本应用页面申请纯音频的麦克风，以及 PDF 查看器的全屏。
  - 摄像头、屏幕、定位、通知、USB、串口、HID 一律拒绝。
- **后处理**：SenseVoice 偶尔输出全大写英文，转成正常大小写，IELTS、PTE 等缩写保持大写；去掉事件和情绪标签。
- **实测**（本机 CPU）：加载 1.4 秒；5～7 秒的音频约 0.25 秒识别完。中文、粤语准确，英文偶有错词，所以文字总是先给老师看。
- **云端（可选）**：「设置 → 语音输入 → 识别方式」可以改成「你的 AI 服务」，默认仍是本机。没下载模型、而 AI 服务又能接收音频时，首次录音的弹窗里也会提供这个选项。
  - **服务商**：只支持 OpenRouter(`google/gemini-3.8-flash`，以 `input_audio` 发送 wav)和 OpenAI(`/v1/audio/transcriptions`，`gpt-4o-transcribe`)。Anthropic 和自定义兼容端点不接收音频，选了云端会提示改用本机。
  - **key 和费用**：用的是「API key」设置里的同一个 key，不需要另开账号。按 OpenRouter 2026-10-29 的价格，2 分钟录音远不到一美分。
  - **录音处理**：录音转成 16 kHz 16 位 wav，只发给这一个服务，不保存。超时 60 秒；错误信息只说明原因，不包含 key。
  - **实测**（2026-10-29，OpenRouter）：澳洲口音的 Stella 段落 18 秒，9 秒返回，逐字正确；中文短句 5.5 秒返回，正确。比本机慢，但不用下载、不占内存。
