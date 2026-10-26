# 附录 D：LaTeX / Beamer 输出

> 本文件是 [SPEC.md](../SPEC.md) 的附录，规定讲义、练习卷、答案卷、底稿和课堂幻灯片如何用 LaTeX 排版、编译、交互修改和分发。
> 设计规则见[附录 C](teaching-design.md)，模板原型见 `prototypes/latex-docs/` 和 `prototypes/beamer/`（D.4、D.5）。

---

## D.1 输出格式选择

| 产出物 | 默认格式 | 可选格式 |
|---|---|---|
| 讲义 / 练习卷 / 答案卷 / 作业 | **LaTeX → PDF** | HTML（Paged.js）→ PDF；DOCX |
| 上课底稿 | **LaTeX → PDF**（A4 横向两栏） | HTML（在应用内打开，适合上课模式） |
| 课堂幻灯片 | **Beamer → PDF** | — |
| 家长反馈 / 报告 | HTML → PDF 或图片卡 | LaTeX → PDF |

- 设置项"排版引擎"：`LaTeX`（默认，前提是有可用的 TeX 运行时）或 `HTML`（在 TeX 运行时还没装好时作为过渡）。
- 两种格式都由**同一份产出物 JSON** 渲染，切换格式时不需要重新生成内容。

---

## D.2 核心原则：AI 不直接写 LaTeX 样式

```
AI ──► 产出物 JSON（Zod schema，每个节点有稳定 id）
        │  文本字段只用受限的内联标记：**粗** *斜* __空__ [[gap:3]] {{gloss:词|释义}}
        ▼
 模板引擎（确定性代码）──► .tex（只调用语义宏 / 环境）+ 行号→节点 id 映射
        ▼
 TeX 引擎（沙箱编译）──► PDF + 日志 + 命名目标坐标 + 溢出报告
```

1. **主路径是结构化 JSON**。版式意图也写成字段，例如 `columns: 1|2`、`density: compact|normal`、`splitAfter: nodeId`、`answerLines: 25`。
2. **样式和内容分开**。`.tex` 正文里只出现语义宏（`\begin{compare}`、`\cuecard{}`、`\answerlines{25}` 等，接口见 `ENVIRONMENTS.md` 和 `MACROS.md`）。外观完全由 `.cls` / `.sty` 决定，换主题不需要改内容。
3. **转义**由渲染器一次完成，顺序是先处理反斜杠，再处理 `& % $ # _ { } ~ ^`，以及智能引号、全角符号、`< >`。
4. **逃生口 `rawLatex` 节点**：只允许白名单里的宏（`\textbf \emph \underline \\ \vspace \hfill`、tabularray、作业目录内的 `\includegraphics`）。由一个 tokenizer 检查：宏是否在白名单内、括号是否平衡、环境是否配对。禁止 `\input \write \immediate \def \catcode \directlua` 等。
5. **编译失败时自动修复**：解析日志（参考 LaTeX Workshop 的 MIT 许可解析器），通过行号映射找到出错节点，**只把这个节点的 JSON 和错误摘要发回给 AI**，让它做局部修复。最多尝试 3 次；仍然失败就回滚到这个节点上一个能编译的版本，并标红。

---

## D.3 TeX 运行时与分发

### 决策

| 用户 | 引擎 | 说明 |
|---|---|---|
| **作者本人（已装 TeX Live 2026）** | 本机 TeX Live（`xelatex` + `latexmk`） | 设置里打开"使用本机 TeX"；检测到 TeX Live 时自动建议打开 |
| **分发版默认** | **Tectonic**（MIT，单个二进制）+ **我们自己托管、锁定版本的 bundle** | 安装包里自带 Tectonic 和一份"预热缓存"（只包含模板用到的宏包和字体，估计 30–60MB），**装好就能离线用** |
| 兜底 1 | 我们托管的精简版 TeX Live 便携包（infraonly + 白名单，压缩后每个平台约 80–150MB，首次使用时下载） | 只在 Tectonic 不兼容时使用 |
| 兜底 2 | 云端编译（需要用户主动开启） | 编译完立即删除，可选数据区域（澳洲 / 美国）；默认关闭 |

- **所有模板只用 XeLaTeX**（Tectonic 不支持 LuaLaTeX），保证不同机器上的版式完全一致。
- 不使用浏览器端的 WASM TeX：这类方案对 fontspec 和 beamer 的支持还不成熟，速度也慢 2–5 倍。
- 安装包的 Tectonic 二进制需要签名：macOS 用 Developer ID + hardened runtime + 公证，Windows 用代码签名，避免被 SmartScreen 或 Defender 拦截。

### 检测本机 TeX
- 查找顺序：用户手动配置的路径 → PATH 里的 `xelatex` / `latexmk` → 常见安装路径。Windows 下是 `C:\texlive\20xx\bin\windows` 和 MiKTeX 的路径；macOS 下是 `/Library/TeX/texbin`。注意 Electron 从 Finder 启动时拿不到 shell 的 PATH，需要用 `shell-env` 补上。
- 用 `xelatex --version` 区分 TeX Live 和 MiKTeX 并读出年份；用 `kpsewhich` 批量检查宏包是否齐全。
- 本机环境缺宏包时，只提示缺哪些，不擅自用 tlmgr 安装；如果没法补齐，自动改用内置的 Tectonic。

### 字体
- 随应用打包 OFL 许可的字体，模板里一律用 `fontspec` 的 `Path=` 从相对路径加载，**不读取系统字体**。
- 每次编译时，把字体硬链接到作业目录下的 `fonts/`，避开 Windows 上中文用户名或路径带空格导致 XeTeX 出错的问题。

### 新手体验（不懂技术的老师）
- 老师**感知不到 TeX 的存在**：设置里不出现"TeX"这个词，只显示"排版引擎：已就绪 ✓"。
- 第一次导出 PDF 时，如果需要补拉宏包，显示进度条，文案是"正在准备排版组件（约 30 秒，仅首次）"。

---

## D.4 编译管线

- **命令**：
  - Tectonic：`tectonic -X compile --synctex --untrusted --keep-logs`
  - 本机 TeX：`latexmk -xelatex -interaction=nonstopmode -file-line-error -halt-on-error -synctex=1 -no-shell-escape`
- **沙箱**：设置 `openout_any=p` 和 `openin_any=p`；工作目录限定为临时作业目录；清空 `TEXMFHOME`；超时（讲义 30 秒，Beamer 60 秒）后结束整个进程树。
- **队列**：同一份文档只保留最新的一次编译（防抖 300–500ms），全局并发数为 `max(1, cpu/2)`。
- **预计耗时**（待在 Win / Mac 上实测）：
  - 10 页讲义 2–4 秒
  - 15 页 Beamer 4–8 秒
  - **Beamer 单页预览 < 1 秒**：生成一份只含"导言 + 一个 frame"的临时文档来编译

---

## D.5 交互式修改

| 能力 | 实现 |
|---|---|
| PDF 预览 | pdf.js 按页懒加载；重新编译后只替换内容哈希有变化的页，并保持滚动位置 |
| PDF ↔ 节点双向定位 | **主方案**：模板在每个节点开头输出 `\hypertarget{n:<id>}{}`（Beamer 用 frame 的 `label=<id>`），再通过 pdf.js 的 `getDestinations()` 拿到坐标。**辅助**：用 SyncTeX 定位到行 |
| 框选后用自然语言修改 | 在 PDF 上框选一块区域，得到选区内的节点 id、该页截图和这些节点的 JSON，交给 AI。AI 返回 JSON Patch 或高层操作：`splitFrame`、`setColumns`、`setDensity`、`moveNode`、`rewriteText`。改动以 diff 形式呈现，老师确认后才生效 |
| 自动发现"太挤" | 每个 frame 或每页结束时，把 `\pagetotal` 和 `\textheight` 写进 aux 文件；超出就标为溢出，并提供"拆成两页"或"压缩"的一键修复 |
| 差异高亮 | 按 JSON diff 找出改动的节点，在对应坐标画高亮框；也可以对新旧页做 pixelmatch 位图比较 |
| 幻灯片缩略图 | 左栏显示每页缩略图，可以拖拽调整顺序（即对 JSON 重新排序），也可以在单页上打开 AI 修改 |
| 降级 | TeX 编译失败时显示上一份成功的 PDF，并给出修复建议；TeX 运行时还没就绪时显示由 JSON 渲染的 HTML 内容视图，标注"非最终版式" |

---

## D.6 接口

```ts
type EngineKind = 'tectonic' | 'portable-tl' | 'system-texlive' | 'system-miktex' | 'cloud';

interface EngineInfo { kind: EngineKind; binDir: string; version: string;
  missingPackages: string[]; bundleVersion?: string; }

interface CompileJob {
  id: string; docId: string; mainTex: string; files: Record<string, string | Buffer>;
  fontsDir: string; passes?: 'auto' | 1 | 2; synctex?: boolean; timeoutMs?: number;
  onlyFrames?: string[]; signal?: AbortSignal;
  lineMap: Array<{ fromLine: number; toLine: number; nodeId: string }>;
}
interface TexError { severity: 'error' | 'warning' | 'badbox'; message: string;
  line?: number; nodeId?: string; context?: string; }
interface CompileResult { ok: boolean; pdf?: Buffer; log: string; errors: TexError[];
  destinations?: Record<string, { page: number; x: number; y: number }>;
  overflow: string[]; durationMs: number; engine: EngineInfo; }

interface TexEngine {
  detect(): Promise<EngineInfo[]>;
  ensure(opts: { prefer?: EngineKind; packages: string[];
    onProgress?(p: number, msg: string): void }): Promise<EngineInfo>;
  compile(job: CompileJob): Promise<CompileResult>;
  warmup(): Promise<void>;
}

interface DocRenderer {
  render(doc: ArtifactJSON, opts: { theme: string; variant: 'student' | 'teacher';
    onlyNodes?: string[] }): { tex: string; lineMap: CompileJob['lineMap'] };
}

interface LayoutEditor {
  edit(doc: ArtifactJSON, sel: { nodeIds: string[]; pageImage?: Buffer },
       instruction: string): Promise<JsonPatch>;
  repair(nodeId: string, errors: TexError[]): Promise<JsonPatch>;
}
```

---

## D.7 文档模板（讲义 / 练习卷 / 答案卷 / 底稿）

原型放在 `prototypes/latex-docs/`，接口说明见 `ENVIRONMENTS.md`。全部用 XeLaTeX 编译通过，没有 Overfull 警告。

| 项 | 规范 |
|---|---|
| 文件 | `tutordesk.cls` + `td-exercises.sty` + `td-script.sty` |
| 字体 | 正文 Source Serif 4，标题和结构文字 Source Sans 3，IPA 用 Charis SIL；全部从 `fonts/` 按文件加载。`chinese` 选项启用中文字体，默认关闭 |
| 版心 | A4；正文 10.5/14.5pt；左右边距 23mm。题号、段落字母、练习号共用左侧 7mm 网格 |
| 颜色 | 只用墨蓝 #24508F 一种，且只出现在练习号、小节标题、标签上。正例和反例用 ✓/✗、实线/虚线、文字标签来区分，所以**灰度打印也能看清** |
| 强调 | 每页只用 `\emph` 一种强调方式；释义用 `\gloss`（行间小字）或 `\sidegloss`（同行右侧），不用脚注 |
| 双栏 | 只有短题（TFNG、选择、填空笔记、配对、WFD 编号）用双栏；阅读文章、作答线、SWT 和作文一律单栏全宽。每道题装在不可拆分的盒子里，不会跨栏或跨页 |
| 三种版本 | `student` / `teacher` / `key`（只出答案卷），同一份源文件生成，编号保持一致。教师版的页眉和页脚有 "Teacher's edition" 标记 |
| 底稿 | `\stage{分钟}{标题}`，时钟自动累加，并自动生成时间表；话术（正体）、预期回答（斜体）、操作和备选方案（无衬线）三种文字一眼可分；`fallback{条件}` 写备选方案 |
| 编译 | 每个文档冷编译约 3 秒，热编译约 1.5–2 秒（本机 TeX Live 2026，latexmk） |
| 依赖 | fontspec、microtype、geometry、fancyhdr、lastpage、needspace、multicol、xcolor、graphicx、enumitem、array、tabularx、booktabs、etoolbox、l3kernel/xparse；中文模式另加 xeCJK、ctex 系列。这就是 Tectonic 预热缓存需要的最小宏包集合 |

**原型里已知要修的问题**
- 听力填空的空格长度不一致。按照附录 C.3，所有空格必须等长，避免泄露答案长度。`\gap` 改成统一宽度，只允许按版式整体调整。
- 中文字体 Fandol 的许可证是 GPL 加字体例外，不是 OFL。分发版如果要支持中文注释，改用思源宋体或思源黑体的子集（OFL）。
- 还没有在 Tectonic 上实测，M0 要补上。

## D.8 Beamer 主题

原型放在 `prototypes/beamer/`，接口说明见 `MACROS.md`，对比图是 `compare-p3-p5.png`。

**架构**：一个共享的语义层 `tutorlesson.sty`（只定义宏，不管外观），加上 4 个外观主题。AI 生成的 `.tex` 只使用语义宏，**换风格只需改 `\usetheme{}`**。没有直接套用 metropolis、moloch 这类现成主题，因为它们的标题、导航和 block 结构很难彻底换掉，也做不到"内容里只出现语义宏"。

| 主题 | 气质 | 字体 / 强调色 | 适用场景 | 排名 |
|---|---|---|---|---|
| **tutorswiss**（默认，2026-10-26 确定） | 极简瑞士风：细线，左边 28mm 放标签、右边放内容的网格 | Inter / 墨蓝 #24508F | 日常屏幕讲解，各种页面类型都稳 | 1 |
| **tutorbook** | 书卷教辅风：小型大写标签，书眉，题卡用双细线框 | Source Serif 4 / 朱红 #9B2A1D | 写作、阅读精讲；打印出来也好看 | 2 |
| **tutorsheet** | 可书写工作纸：题号放在方框里，带填写栏、书写行、计时刻度 | Atkinson Hyperlegible Next / 石油蓝 #0D6577 | 学生在平板上直接用笔在 PDF 上作答 | 3 |
| **tutorfocus** | 深色焦点风：标题弱化，内容放大，页脚用细进度条 | IBM Plex Sans / 暖黄 #E8B84E，底色 #15181D | 共享屏幕时突出一句话或一张题卡；整套 deck 都用它会显得空 | 4 |

- 16:9 画面（160×90mm）：正文 10–12pt，在 1080p 屏幕上大约 40px，共享屏幕时可读。
- 错误标注统一用"波浪下划线 + 上标编号"，修改处用实线下划线，不用红绿色块。
- **语义宏**（完整列表见 `MACROS.md`，和附录 C.4 的 12 种页面类型对应）：`\titleslide`、`objectives`、`compare`（`\original` `\revised` `\why` `\err` `\fix`）、`\peel` / `flow`、`cuecard`、`taskcard`、`timed` / `\timer`、`reveal` / `\step`、`summary`、`exitcheck`、`wordlist` / `\vocab`、`\keyframe`、`\sample`、`\aside`、`\ipa`。frame 可以带 `stage=` 键（Diagnose / Model / Practise / Check 等）。
- `MACROS.md` 给每种页面规定了字数上限，生成后由确定性校验检查。
- 坑：IBM Plex 和 Atkinson 缺少部分 IPA 字形，音标改用 Noto Sans；`\newfontfamily` 要显式加 `Ligatures=TeX`；frame 不能包在宏里，要用命令形式 `\frame[...]{...}`。

**还要补齐的页面类型**（附录 C.4 中原型没覆盖的）：提取热身页、错误诊断页（先找错再揭示）、半填空页、学生作答批注页、PTE 机考界面模拟页。M1 补齐。

**交互**：工作台里的幻灯片视图分三栏：左边是缩略图（可以拖拽排序），中间是单页预览（不到 1 秒出图），右边是 AI 修改栏（"这页太挤，拆成两页"、"把对比改成 3 组"、"换成 focus 风格"）。整套主题可以随时切换，切换后自动全量重新编译。
