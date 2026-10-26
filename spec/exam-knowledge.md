# 附录 B：考试知识框架与错因体系

> 本文件是 [SPEC.md](../SPEC.md) 的附录。它定义考试插件的结构、各考试要点和通用错因库。
> ⚠ 标注"待核实"的考试改版信息来自第三方备考网站。写进插件之前，必须回官网核对，并在插件的 `sources` 字段里记录核对日期。

---

## B.1 考试插件（ExamPlugin）结构

每门考试是一个**版本化的配置包**，以 skill 目录的形式存放在 `workspace/.claude/skills/exam-<id>/` 下。这样同一份知识可以给 Claude Agent SDK、Codex、OpenCode 和 API harness 共用（见 SPEC §7.6）。

```
exam-ielts-academic/
├─ SKILL.md                 # 考试概览 + "什么时候读哪个文件"的索引（给 agent 看）
├─ plugin.json              # 机器可读的元数据（见下）
├─ structure.md             # 科目 → 部分 → 题型，含题量、时长、作答方式（机考/纸笔）
├─ band-descriptors/        # 官方评分标准原文（可公开引用的部分），按维度拆成多个文件
├─ scoring.md               # 原始分换算成标准分，以及总分取整规则
├─ task-types/*.md          # 每种题型的规格、常见陷阱、教学方法
├─ error-taxonomy.json      # 本考试适用的错因代码 = 通用库 + 本考试专有项
├─ level-bands.json         # 分档定义及对应的教学策略（如 4.5 / 5.5 / 6.5 / 7.5+）
├─ templates/               # 本考试的大纲、底稿、报告模板的变体
└─ facts.json               # 可核验的事实断言，供 fact-check 用
```

```ts
interface ExamPluginMeta {
  id: string;                       // 'ielts-academic' | 'ielts-general' | 'pte-academic' | 'pte-core'
  name: string;
  version: string;                  // 考试改版时升级插件版本；旧学生的数据仍按旧版解读
  effectiveFrom: string;            // 生效日期
  variants?: string[];              // 地区/卷别变体：省份、Academic/GT 等
  skills: SkillNode[];              // 能力树，如 阅读 → 定位 / 同义替换 / 推理
  cefrMapping?: Record<string, string>;
  scoreScale: { min: number; max: number; step: number; rounding?: string };
  rubricDimensions: { id: string; name: string; appliesTo: string[] }[];
  levelBands: { id: string; range: [number, number]; strategy: string }[];
  contentPolicy: { allowBundledItems: false; citationRule: string };
  sources: { url: string; checkedAt: string }[];
}
```

**分层**：通用层放 CEFR 能力模型、通用错因库和通用模板，各考试只覆盖与通用层不同的部分。

---

## B.2 MVP 首批插件与要点

### 雅思 IELTS（Academic / General Training），P0

**写作批改要点（四项各占 25%）**
- **TA（Task 1）**
  - Academic：有没有 overview（没有 overview 的话，TA 很难超过 5 分）；关键特征选得对不对；有没有做比较；数据是否准确。
  - GT：三个要点是否都覆盖；语气和写信目的是否相符。
- **TR（Task 2）**
  - 题目的每个部分是否都回应了。双问题题型最容易漏掉一问。
  - 立场是否清楚，并且全文一致。
  - 论点有没有展开、有没有支撑。例子太泛不算支撑。
  - 是否跑题，或者像背诵稿。
- **CC**：每段是否只有一个中心；连接词有没有机械堆砌；指代和替代用得怎样（this trend / such policies）；段落之间是否在推进论证。
- **LR**：词汇范围和准确度；搭配错误（例如 make a research）；词形和拼写；有没有为显得高级而误用大词；有没有重复。
- **GRA**：复杂句占多少，用得准不准；无错误句子的比例（6 分要求 "frequent error-free sentences"）；标点。

**批改输出格式**
1. 四项各给一个分数**区间**，并列出与评分标准原文对应的关键词。
2. 列出 3 处最影响分数的问题。
3. 给一段示范改写：保留学生原意，只提高半档到一档，不要改成 9 分范文。
4. 布置一个下次写作的专项任务。

**口语诊断（FC / LR / GRA / P）**
- **FC**：语速；不自然停顿出现在哪里（是在找词，还是在组织语法）；自我修正的频率；回答长度（Part 1 要说 2–3 句，Part 3 要有观点、理由、例子和让步）；连接手段是否多样。
- **LR**：话题词汇；习语用得自然不自然（防止生搬硬套）；能不能用换说法来补救。
- **GRA**：时态是否一致（Part 2 讲过去的经历时最容易出错）；复杂结构；错误密度。
- **P**：单个音素（/θ/ /v/ /ɪ/–/iː/）、词重音、句重音、连读、语调分组。要区分"影响理解的问题"和"只是口音"，后者不应重罚。发音分析要依赖专门的发音评测引擎（见 SPEC §7.7），LLM 不能只凭文本判断发音。
- **按 Part 分别看**：Part 1 能否自然展开；Part 2 能否讲满 2 分钟，结构是否完整、细节是否具体；Part 3 能否做抽象概括和比较。
- **背诵稿识别**：语调突然变平、回答和题目贴合度低、用词明显高于平时水平。出现这些信号时提醒老师。

**机考适配**：多数市场的雅思已以机考为主，并有单科重考（One Skill Retake）（待核实各考点政策）。练习材料要支持打字作答，讲义里要包含机考界面的操作提示。

### PTE Academic（含 PTE Core 变体），P0

> ⚠ 以下题型、时长和评分维度依据 2021 年之后的格式，以及 2025-08 的改版信息。写进插件前要逐项对照 Pearson 官方的 *Score Guide for Test Takers* 和官网题型页核实，并记下核实日期。

**结构（约 2 小时，机考，AI 评分）**

| 部分 | 题型 | 关键规格和评分要点 |
|---|---|---|
| 口语与写作 | Personal Introduction | 不计分 |
| | **Read Aloud (RA)** | 计入口语和阅读；评分维度：内容、流利度、发音 |
| | **Repeat Sentence (RS)** | 计入口语和听力 |
| | Describe Image (DI) | 准备 25 秒，作答 40 秒 |
| | Re-tell Lecture (RL) | 计入口语和听力 |
| | Answer Short Question (ASQ) | 用一个词或短语作答 |
| | Summarize Group Discussion（2025 新增，待核实） | 计入口语和听力 |
| | Respond to a Situation（2025 新增，待核实） | 情境回应，计入口语 |
| | **Summarize Written Text (SWT)** | 一句话，5–75 词，限时 10 分钟；**形式不合格时其他维度也可能不得分** |
| | Write Essay | 200–300 词，限时 20 分钟；评分维度：内容、形式、结构连贯、语法、词汇广度、拼写等 |
| 阅读 | **Reading & Writing Fill in the Blanks** | 计入阅读和写作，是公认的高权重题型 |
| | Multiple Choice（单选 / 多选） | 多选**答错倒扣分** |
| | Re-order Paragraphs | 按相邻对给分 |
| | Reading Fill in the Blanks | — |
| 听力 | Summarize Spoken Text (SST) | 50–70 词，限时 10 分钟 |
| | Multiple Choice（单选 / 多选） | 多选倒扣分 |
| | Fill in the Blanks（听力） | 拼写必须正确 |
| | Highlight Correct Summary / Select Missing Word | — |
| | Highlight Incorrect Words | 倒扣分 |
| | **Write From Dictation (WFD)** | 计入听力和写作，高权重 |

**计分**：总分和听说读写四个单项都是 10–90 分；2021 年起成绩单不再报告 enabling skills。目标分通常来自签证或移民要求（如各单项 65、79），**要看最弱的那个单项**。

**教学要点**
- **题型 → 单项 贡献矩阵**：插件里维护一张"每道题计入哪些单项、大致权重"的表（待核实）。诊断时据此算出"每提高 1 分投入产出比最高的题型"，大纲按这个排序。高频高权重题型一般是 RA、RS、WFD、R&W FIB、听力 FIB。
- **形式规则一票否决**：SWT 写成多句、Essay 字数超出范围、SST 字数不符，都可能导致整题低分。确定性校验要能检查学生作答和 AI 示范是否合规。
- **口语评的是流利度和发音，不是想法**：要避免长停顿、重复和自我纠正，内容"说完整"比"说得好"更重要。这部分高度依赖发音和流利度数据。发音评测暂缓期间，只能根据转写和停顿给出流利度建议，并明确告诉老师"发音未评估"。
- **模板策略要谨慎**：DI、RL、Essay 的结构模板有用，但 2025 年起检测会加强（待核实），模板必须搭配题目相关的具体内容，产出物里不能出现"万能句"堆砌。
- **机考操作**：倒扣分题的作答策略（拿不准的选项不选）、时间管理、耳机和麦克风设置、录音开始的提示音，都应写进讲义和上课底稿的"考场策略"部分。

**PTE 专有错误标签**（补充 B.4）
```
PTE-FORM-SWT  SWT 写成多句或字数超出范围      PTE-FORM-WC   Essay / SST 字数不在范围内
PTE-WFD-MISS  WFD 漏词                        PTE-WFD-SPELL WFD 拼写错误
PTE-RS-MISS   RS 复述不完整                   PTE-FLU-HES   长停顿或犹豫（> 3 秒）
PTE-FLU-REP   重复、自我纠正                   PTE-DI-STRUCT DI 结构不完整（缺总述或结论）
PTE-MC-NEG    多选题因猜测被倒扣              PTE-FIB-COLL  填空题选错搭配
PTE-FIB-GRAM  填空题词性或语法不匹配          PTE-TIME      超时或时间分配失误
```

### 范围说明

产品**只做雅思和 PTE Academic**（2026-10-26 决定）。新概念、高考、剑桥五级、托福等不在路线图上。插件框架仍保持通用，但不为它们投入内容建设。

---

## B.3 通用错因库（阅读、听力）

每道错题都打上**主错因 + 次错因**。阶段报告按错因出现的频次做帕累托排序，排在前面的错因决定下一阶段的教学重点。

| 大类 | 代码 | 说明 | 怎么识别 |
|---|---|---|---|
| **L 定位** | L1 | 关键词选错 | 学生标的定位句和正确定位句不一致 |
| | L2 | 找到了位置，但范围不对 | |
| | L3 | 题序假设错了（例如以为 summary 题按原文顺序） | |
| | L4 | （听力）漏听信号词，跟丢进度 | |
| **P 同义替换** | P1 | 没认出词汇层面的替换 | 定位对了，答案却错了 |
| | P2 | 没认出句法层面的改写（主动变被动、名词化等） | |
| | P3 | 没认出概括性替换（上位词 / 下位词） | |
| **V 词汇** | V1 | 生词 | |
| | V2 | 熟词僻义 | |
| | V3 | 拼写错误（听力填空） | 单独统计，因为最容易补救 |
| | V4 | 单复数或词形错误 | |
| **G 句子理解** | G1 | 长难句结构没看懂 | |
| | G2 | 否定、转折、限定词理解错（only / not all） | |
| | G3 | 指代没弄清 | |
| **R 推理逻辑** | R1 | 混淆 TRUE / FALSE / NOT GIVEN 的判断标准 | TFNG 单独建子统计 |
| | R2 | 过度推理，用常识代替原文 | |
| | R3 | 把别人的观点当成作者观点 | |
| | R4 | 段落主旨题被细节干扰 | |
| **D 干扰项** | D1 | （听力）说话人中途改口、自我纠正 | |
| | D2 | 原文出现过这个词，但不是题目问的内容 | |
| | D3 | 选了绝对化表述的选项 | |
| **T 时间与策略** | T1 | 超时，没做完 | 需要每篇 Passage 的用时数据 |
| | T2 | 在难题上卡太久 | |
| | T3 | （听力）预读不够 | |
| | T4 | 机考时誊写或操作失误 | |
| **S 规则** | S1 | 超出字数限制（NO MORE THAN TWO WORDS） | |
| | S2 | 格式错误（大小写、数字写法） | |

## B.4 写作 / 口语错误标签（通用 + 雅思专有）

```
W-TR-POS   立场不清或前后不一致          W-TR-DEV   论点没有展开
W-TR-PART  漏答题目的某个部分            W-TR-OFF   跑题，或像背诵稿
W-CC-PARA  一段里有多个中心              W-CC-MECH  连接词用得机械
W-CC-REF   指代不清                     W-CC-CONC  结论里出现新观点
W-LR-REP   用词重复                     W-LR-COLL  搭配错误
W-LR-FORM  词形或拼写错误                W-LR-MIS   大词误用
W-GRA-SVA  主谓一致错误                  W-GRA-REL  关系从句错误
W-GRA-CONJ 连词冗余（although…but）     W-GRA-TENSE 时态错误
W-GRA-ART  冠词错误                     W-GRA-PUNC 标点错误
S-FC-PAUSE 不自然停顿                    S-FC-LEN   回答太短
S-FC-FILL  填充词过多                    S-GRA-TENSE 时态不一致
S-P-PHON   单个音素问题                  S-P-STRESS 重音或语调问题
```

每个错误实例的记录格式（追加写入 `error-log.jsonl`）：

```json
{"id":"e-2026-10-19-003","code":"W-GRA-CONJ","excerpt":"Although longer prison sentences can scare criminals, but…",
 "source":"submissions/2026-10-19-essay-01.md#L3","lesson":"L01","date":"2026-10-19","status":"open|practicing|resolved"}
```
