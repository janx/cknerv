# Canvas 与动画渲染性能优化计划

日期：2026-09-11。状态：实施与验收中。审查基线：`e49ac7e3`，workspace 1.0.5。

本计划依据本轮代码审查和 CPU 微基准，安排实施顺序与验收方法。现行行为契约
仍以 [Canvas 文档](../canvas-rendering.md) 为准；下面的目标不代表已达到的性能，
也不提前改变现有视觉、调度或数据契约。

## Goal

- 降低检查面板开启、相机移动和区块落地时的主线程峰值，保持输入与动画响应。
- 将桥接选择、布局求解和故障恢复拆成有成本边界的工作，统一核算帧预算。
- 减少空槽绘制、无效缓冲区上传与增量更新中的全量扫描。
- 建立可重复的 CPU、GPU、帧间隔和视觉验证，区分计算变快与画面被简化。

## Principle Alignment

- **CKB Native**：保持 Cell 身份、`pos_seed`、真实端点、拓扑与事件含义。
  High、Med、Low 的 AUTO 成员和被动网络数量继续一致，不通过丢弃事件或
  隐藏已打开面板达到性能目标。
- **Local First**：沿用本地节点、浏览器 Worker、单 WebGL Canvas 和现有
  renderer，不引入渲染服务或节点写操作。
- **Agent Friendly**：每阶段明确源码范围、复现输入、回归检查和退出条件；
  基准不依赖某台机器的临时文件。
- 保持包边界：主要修改在 `packages/ui/`，必要应用接线在 `ui-app/`。Rust/TS
  wire、确定性 helix、服务端投影、配置与持久化不属于本轮优化范围。

## Result

- 计划交付：可复现基准、主要 CPU 瓶颈优化、共享预算修正、可响应的 Worker
  恢复、mote 有效范围绘制与上传，以及按收益决定的 Cell 槽位增量化。
- State/purge required：**no**。按当前范围无需 schema bump 或清理本地状态。
- 已实施仓库内 CPU 基准、canonical 等价剪枝、bridge 三段游标、共享预算、
  cooperative Worker 恢复、mote 有效前缀/稀疏上传与 Cell 槽位增量提示。
- S1 已接入可恢复 canonical 求解与共享预算。随后用户明确批准相机实际移动
  期间隐藏检查连线/标签：reticle、name chip、面板和选择保留，停稳后再以最新
  几何分片恢复；移动帧不再重接或求解路线。旧版最终源码空窗微基准的持续移动
  p95 为 2.28 ms，最大观测外层调用为 8.97 ms，属于新规则之前的历史证据。
- S6 已执行 AMD Radeon 890M 硬件 ANGLE 配对的两组 idle/motion、六视口
  非全笛卡尔矩阵和包含前后台切换的 30 分钟 live soak；第三组配对中止，仍缺
  校准 GPU 计时、完整事件/设备矩阵和 50K 实际展示。执行证据与限制记录在
  文末，不能把阶段测试通过或部分硬件覆盖写成整体验收完成。

### 1. 已确认的基线

以下为 Node v22.22.2、Ryzen AI 9 HX 370 上调用生产函数的墙钟耗时；未隔离
背景负载，受 JIT、GC 和系统调度影响。**不是浏览器 FPS 或 GPU 时间**。
12K 是 AUTO 默认/兼容预算，实际服从服务端 display budget；50K 只是容量
上限压力场景。

| 编号 | 问题与触发条件 | 审查证据 | 阶段 |
|---|---|---|---|
| F1 / P1 | 四面板、拥挤视口中锚点移动，位置锁定后仍完整寻路 | 1180×663：p50 12.58 ms、p95 24.93 ms；首次 75.42 ms | S1 |
| F2 / P1 | bridge 全量候选扫描、排序与规划位于一个同步步骤 | 12K 冷缓存 p50 38.34 ms；50K 热缓存 p50 27.11 ms | S2a |
| F3 / P2 | Worker 失败后同步构建完整拓扑 | 注入构造失败，12K 两次均阻塞事件循环约 2 秒 | S3 |
| F4 / P2 | 低优先级先花费，最后运行的高优先级不扣减已有花费 | drain 8 + bridge 3 + plan 4 ms 均获准，总计 15 > 12 ms | S2b |
| F5 / P2 | mote 按容量绘制，局部属性变化整条上传 | 7 组有效时提交 6144 点而非 672 点；gulp 改 384 B、上传 24576 B | S4 |
| F6 / P3 | 单个 payload 更新仍扫描所有槽位并复制 published 数组 | 12K/50K 分别 12000/50000 次 Map get；p50 0.61/2.50 ms | S5 |

复现输入：`helixSeedF64` 生成存活 Cell，`k=5`、`maxEdgeLength=42`，passive
edge budget 8000，bridge 默认选项；计时排除 population placement 和拓扑
准备，冷缓存 5 次、热缓存 30 次。面板采用现有矩阵测试中的 440×717、280×314、
408×340、560×420 四张卡片，chip 376×24、safeTop 104、edge 14；从视口中心
开始，每次水平移动 1 CSS px，初次之外记录 60 次，DOM handles 为空。
S0 必须补生产浏览器实测，不能直接把这批数字作为 CI 门槛。

保留已有效的优化：稳定 GPU 槽位与稀疏上传、Worker 增量拓扑与合并派发、近景
nucleus 12/8/4 上限、运动期间 hover 暂停、质量控制 DPR/ambient、画像
portal/scissor 复用主 renderer。

### 2. 实施顺序与目标

| 阶段 / 建议变更单元 | 交付 | 依赖 | 主要风险 |
|---|---|---|---|
| S0：基准与观测 | 固定输入、手动基准入口、浏览器对照、必要计数 | 无 | 探针改变性能 |
| S1：检查面板 | 分离缓存失效、减少路由重算、约束完整求解 | S0 | 连线/标签/透明窗口遮挡回归 |
| S2a：桥接计算 | 可恢复的 sync/select/reconcile 与增量缓存 | S0 | 选边不确定、过期结果落地 |
| S2b：共享预算 | 总花费和预留额度统一，保持 deadline 与防饿死 | S1、S2a | 任务延迟超出事件窗口 |
| S3：Worker 恢复 | 正常与恢复路径共用算法，恢复可让出主线程 | S2b | 双算法漂移、重试积压 |
| S4：mote 提交 | 有效 drawRange、属性 dirty ranges | S0 | 换槽后的残留与错配 |
| S5：Cell 槽位 | 增量维护，单独处理不可变快照成本 | S0；高优先级完成后 | 拾取/缓存身份回归 |
| S6：整体验收 | 生产构建配对测量、视觉矩阵与长时间验证 | 已实施阶段 | 漏测交互或恢复路径 |

主顺序为 S0 → S1 → S2a → S2b → S3 → S4 → S5 → S6。S4 可独立提交；S5
按实测收益控制范围。S6 发现的其他 GPU 热点另立小项，不预先重写全部材质。

以下是**初始工程目标**，在 S0 指定参考设备、浏览器、真实渲染路径后锁定。
因测量条件修正而重定基线必须说明原因，不通过提高门槛掩盖回归。

| 范围 | 目标 | 判定方式 |
|---|---|---|
| 锁定面板中的锚点移动 | 1180×663 四面板 CPU p95 ≤ 2 ms；实际相机移动期不枚举布局/路由、不闪回连线，停稳后记录恢复延迟 | 微基准、浏览器 trace、操作次数 |
| 面板完整求解 | 主线程单次连续执行目标 ≤ 8 ms；超标则设计可恢复求解 | 首次开启、resize，冷/热分开 |
| bridge 与恢复 | 调度片目标 ≤ 2 ms，p95 ≤ 4 ms；记录最大不可切分子步骤 | 注入时钟/操作上限测试、CPU profile |
| 共享预算 | 先预留关键工作，总预计花费 ≤ 12 ms；实际超支有原因和单步记录 | 真实帧顺序集成测试、ledger |
| mote 绘制 | 点数 = 有效 marks × 96；0 mark 不发 draw | geometry 和真实 draw 计数 |
| mote 更新 | GPU 初始化后，单组单个 float 属性上传 96×4 B；多组按脏范围合并 | 属性范围测试、upload ledger |
| Cell 槽位 | 普通单项变化的查找/维护次数随变化量增长，快照复制单独计时 | 操作次数与分段耗时 |
| 交互与区块落地 | 参考 60 Hz 环境帧间隔 p95 目标 ≤ 20 ms；上述函数不产生 > 50 ms 长任务 | 关闭采样探针的配对 trace |

12 ms 是重任务预算的起点，不是 GPU 渲染保证。若普通帧工作超出预留空间，
应缩小余量；不能因帧变慢就放大预算。强制推进、估计误差与 GC 分开记录，
不宣称 JS 调度提供硬实时上限。同时记录 job 从接收到落地的总延迟，防止
“每片都短、事件却长期不完成”。

### 3. S0：基准与最小观测

**范围：** 新增 `packages/ui/benchmarks/rendering/` 手动基准目录和独立运行
入口；复用 `tweaks/performanceProbeStore.ts`、`nerve/blockFrameStats.ts` 与
upload ledger，不创建第二套性能面板。该目录和入口已实现。

1. 整理可从新 checkout 重建的输入：12K/50K、bridge 冷/热缓存、连续 16 次
   每次替换 120 Cell、2/3/4 面板、单 payload 更新、Worker 故障。拓扑准备、
   预热、显式 GC 与被测调用分开记录；合成 Cell 只用于测试，生产 Lab 使用
   真实快照。
2. 输出 JSON：commit、场景、seed、规模、拓扑参数、样本数、p50/p95/max、
   操作次数、是否含 DOM、环境。计时基准独立运行，不放入普通 Vitest 的
   墙钟阈值断言。
3. 补检查面板 CPU 范围和完整布局/路由重算/缓存命中/候选计数；bridge 与
   恢复记录 generation、单步类型/耗时、排队时长、取消；ledger 区分实际
   花费、预留和超支原因。probe 关闭时避免逐帧字符串/数组/对象分配。
4. 保存生产浏览器的空闲、四面板拖动、区块落地基线。每组预热至少 10 秒，
   空闲/交互窗口至少 30 秒；事件至少 10 个完整周期；同条件配对至少三次。
   冷启动与稳态分开，CPU 基准顺序运行。

**退出条件：** 可重跑且能区分主线程/GPU/DOM 合成；12K/50K 实际展示数量
与配置相符。仅提交小型输入配置、运行脚本与摘要；trace、截图和本机状态留
本地，不提交源码目录。

### 4. S1：检查面板缓存与路由

**范围：**
[cellConstellationFrame.ts](../../packages/ui/src/components/hud/cellConstellationFrame.ts)、
[cellConstellation.derive.ts](../../packages/ui/src/derives/cellConstellation.derive.ts)、
[CellInspectionOverlay.tsx](../../packages/ui/src/components/CellInspectionOverlay.tsx)。

1. 分离面板/stage 几何、静态 HUD 障碍、移动锚点/reticle/chip 三类失效。
   移动 chip 不能进入永久障碍缓存；字体、内容高度、面板关闭、HUD version、
   resize、更换 Cell 都有明确失效范围。
2. 复用方向枚举、路由顺序、静态障碍节点与连通信息。锁定时先验证已有结果，
   再更新移动端点涉及的部分，避免每 0.5 px 重建 24 种顺序及同一避障图。
3. 保持 canonical 候选顺序、评分和 tie-break。仅在能证明缓存结果符合相同
   选择规则时复用；“没有碰撞”不能单独证明结果等价。记录图构建、候选和
   搜索量的实际减少。
4. 首次/完整失效先做等价剪枝与 scratch 复用。仍超标则改为可恢复任务，重
   求解计入 S2b，轻量 reticle 更新继续按帧执行。旧结果只有通过当前几何
   验证才可显示，不能留下穿障碍的旧线；没有旧结果时不能通过隐藏已打开
   面板或遮罩无限等待验收。首次有效呈现延迟、扫描时序和 resize 一并验证。
5. 按实际变化提交 DOM/SVG；保留单 renderer、scissor、pointer capture、
   现有字号/内容/面板数和选择时相机行为。
6. 用户批准的交互边界：相机位姿或投影实际移动时隐藏全部 leader stroke、
   endpoint、线路标签与 panel 内 fallback 标签，保留 selection、reticle、
   name chip、已完成面板和有效画像 seat；移动帧取消在途 cursor，且不准备、
   校验或求解 route。停稳判定必须覆盖 drag、damping、flight、wheel 和 resize，
   不能只读 pointer-up；恢复以最新 anchor/viewport/panel/HUD 几何走既有有界
   cursor，并记录从停稳到全部有效 leader 恢复的帧数/时间。

**回归：** 扩展 `derives/cellConstellation.matrix.test.ts`、
`derives/cellConstellation.derive.test.ts`、
`components/hud/cellConstellationFrame.test.tsx`、
`components/hud/CellConstellationMarks.test.tsx`。覆盖现有视口、中心/边缘/
角落、2/3/4 面板、chip clamp、标签回退、内容测量和单张关闭。

**退出条件：** 达到路由与完整求解目标；静止时不穿面板、名称、reticle、HUD
或其他连线，标签与透明画像遮罩正确。相机移动期 leader/标签持续隐藏且不在
damping 尾部闪回，停止后全部有效 leader 在记录的有界延迟内恢复；关闭 panel、
同 connector key 往返和新选择不复活旧路线。确定性输入按现有规则验证像素一致；
任何其他可见路线变化单列说明并做视觉评审，不能混为无损优化。

### 5. S2a：桥接计算分片

**范围：**
[bridgeEdges.ts](../../packages/ui/src/geometry/bridgeEdges.ts)、
[CellBridgeNerves.tsx](../../packages/ui/src/nerve/CellBridgeNerves.tsx)、
[bridgeSchedule.ts](../../packages/ui/src/nerve/bridgeSchedule.ts)。

1. sync/select/reconcile 改为持有 cursor 的 job，绑定 host/topology、anchor
   index 和选边参数版本。依赖改变时取消/重建，不让旧 job 读取正在被下一代
   修改的输入作为自己的快照。
2. sync 用已知 Cell/边增量维护 degree 与 host；首次或增量断链保留同一
   canonical 重建路径，全量扫描也可让出主线程。
3. ranking 保持现有完整比较顺序；优先增量维护，首次采用可分步排序/归并。
   不能只截原始候选的前 960 项：有些 host 找不到 anchor，仍需继续向后规划。
4. host 规划细到有上限的 anchor 查询/候选处理。一个 host 不保证恒定小成本；
   密集 bucket、排序、结果打包和 reconcile 均记录最大单步。
5. coverage/plan cache 按失效 host 和依赖版本维护，有界增量淘汰替代超出
   `MEMO_CAP` 后整图清空；淘汰只影响性能，不影响结果。
6. 首选现有模块内可恢复的纯选择器。只有切片后总延迟或主线程成本仍超标，
   才将同一选择器移入 Worker，并记录传输量、输入版本和排队规则；不在每次
   构建时复制整个 105K anchor 对象图。

**回归：** `geometry/bridgeEdges.test.ts`、`nerve/CellBridgeNerves.test.ts`、
`nerve/bridgeSchedule.test.ts`、`nerve/bridgeStroke.test.ts`、
`nerve/bridgeSlotRanges.test.tsx`。对冷/热、degree/anchor 变化、缓存容量边界、
取消/重启比较完整边集、顺序、host 数、stroke 身份和生长/撤回时序；以注入
时钟或操作配额验证中断点。

**退出条件：** 12K 冷缓存与 50K 热缓存不再有数十毫秒的单块同步选择；满足
单片目标和原有落地/生长窗口。过期 job 不发布部分结果，分片不重新起算真实
事件时钟。

### 6. S2b：总预算与关键任务预留

**范围：**
[frameBudget.ts](../../packages/ui/src/nerve/frameBudget.ts)、
[NeuralNetwork.tsx](../../packages/ui/src/nerve/NeuralNetwork.tsx)、bridge 调用点、
S1 的重求解任务。复用一个 ledger，不给各模块各加一个 12 ms。

1. 记录每帧总实际花费；优先级只决定顺序和预留，不能让已花费的低优先级时间
   从总账消失。一帧初始化一次；单独挂载的 Lab 有明确预算所有者。
2. drain/bridge 开始前为待处理 live plan 预留片额度，为必要面板求解安排
   有限额度；无任务或已完成的预留及时释放。轻量 HUD 写入属于普通帧成本。
3. 保留 departure clock、模拟时间和事件顺序。优先采用预留，避免直接重排
   R3F 回调破坏 raw clock、fabric landing、bridge 的前后依赖。
4. 三帧防饿死继续保证进展，但豁免只推进已切细的工作单元，不排空整个 job。
   区分 deadline、starvation、估计误差与单步越界；持续超支缩小工作单元。
5. 明确隐藏/恢复、暂停、卸载、无 NeuralNetwork 的 Lab 的预算生命周期，
   避免消费者永远读到上一帧已花费的额度。

**回归：** 更新 `nerve/frameBudget.test.ts`，补实际组件执行顺序集成测试。
在 `drain=8 → bridge=3 → plan=4` 案例中，plan 先预留 4 ms，bridge 在余量
不足时推迟；再覆盖无 plan、多消费者连续等待、估计误差、释放与 reset。
随契约修正旧测试里允许无限大“首个 grain”的断言。

**退出条件：** 面板与区块工作同时发生时预算有效；同输入的
`forcedByDeadline` 不增加，事件数/顺序/时间归属不变，低优先级持续推进。
同步更新 [Canvas 主线程策略](../canvas-rendering.md#151-main-thread-strategy)。

### 7. S3：Worker 故障恢复

**范围：**
[neighborGraphBuilder.ts](../../packages/ui/src/geometry/neighborGraphBuilder.ts)、
[neighborGraph.ts](../../packages/ui/src/geometry/neighborGraph.ts)、
[passiveNeighborGraph.ts](../../packages/ui/src/geometry/passiveNeighborGraph.ts)，
以及实际 Worker 入口与内部消息协议。

1. 提取可恢复的 canonical 拓扑/被动选择构建器。Worker 循环推进至完成，
   主线程恢复逐片推进同一算法，不维护两套 k-NN、连通性或选边逻辑。扫描、
   排序和打包都需有边界，不只切最外层循环。
2. 构造异常、onerror、onmessageerror、超时进入同一恢复状态机。用能让输入/
   绘制获得执行机会的任务边界，不能用连续 Promise 微任务假装切片；绘制
   期间服从 S2b，初始化/无 Canvas 时也有可让出事件循环的调度路径。
3. 有限重试与退避，持续失败不在每个 delta 上重建 Worker。保持最多一个活动
   构建和一个最新待处理请求；定义取消、卸载和完成清理。隐藏期不积压无限
   任务，前台恢复重建预算并处理最新状态。
4. 完成前不发布部分图；保存已验证图版本，拓扑可用性与数据 generation 分开。
   活动路径继续验证当前真实端点，旧图不冒充最新状态；事件沿用既有有界
   生命周期，不新增无限缓冲或静默丢弃。取消的任务不能覆盖更新的结果。
5. 移除“Worker 失败后再完整同步 build”的大块兜底，保留诊断原因和恢复计数。

**回归：** `geometry/neighborGraphBuilder.test.ts`、
`geometry/neighborGraph.test.ts`、`geometry/neighborGraphWorkerProtocol.test.ts`。
注入构造失败、error、无响应、连续更新、卸载；比较正常/恢复结果，验证任务
之间事件循环可响应、有限排队、过期结果不落地和内存释放。

**退出条件：** 12K/50K 故障时主线程保持响应，正常 Worker 性能不退化。若改
Worker 入口/资源加载，必须以 release CLI 验证嵌入 SPA 的冷启动与资源请求。

### 8. S4：mote 有效绘制与稀疏上传

**范围：**
[ColonyCohorts.tsx](../../packages/ui/src/components/ColonyCohorts.tsx)、
[colonyMotes.ts](../../packages/ui/src/materials/colonyMotes.ts)，必要的 upload 计数。

1. 保留 64 组稳定分配，按 marks 数设置 drawRange，0 mark 不 draw。收缩、
   扩张、重排在首次可见绘制前同步完成属性和范围提交。
2. gulp、mass 等动态 lane 按 cohort 切片标 dirty，合并相邻/重叠范围；首次
   GPU 分配允许整条上传，之后局部变更稀疏上传。
3. 分离 position/origin/seed 和 strength/mass/gulp 的失效条件；份额变化不
   重写未变的 seat/seed，nodeId 的 gulp 历史换槽后仍正确。
4. 有效前缀中若仍有长期零强度槽，且 GPU profile 显示有收益，再增加顶点
   提前裁出；先做 drawRange/上传，不同时修改 shader 数学。

**回归：** 扩展 `materials/colonyMotes.test.ts`、
`materials/colonyMotesShaderGuards.test.ts` 并补组件提交测试，覆盖 0/1/7/64、
7→2→7、换槽、同帧多组 gulp、mass 过渡、卸载。验证尾槽不画、有效组动画
相同、旧 updateRanges 不影响后续脏数据。

**退出条件：** 7 组 672 点；初始化后单组 gulp 384 B；确定性截图像素一致，
真实 WebGL shader 编译通过。报告顶点/字节节省和实测 GPU 时间，不把空槽
比例解释为整页 FPS 提升。

### 9. S5：槽位增量与不可变快照

**范围：**
[cellRenderSet.ts](../../packages/ui/src/geometry/cellRenderSet.ts)、
[cellSlotAssignment.ts](../../packages/ui/src/geometry/cellSlotAssignment.ts)、
[CellGalaxy.tsx](../../packages/ui/src/components/CellGalaxy.tsx)，及 picker、生命周期
与近景缓存中实际消费槽位快照的位置。

1. 先分开计时槽位维护与 published 复制；原默认 12K 总开销约 0.61 ms，按
   实际收益控制范围。
2. 用 `CellRenderSetUpdate` 的 `previousCells`、ranges、entered/exited、mode
   校验增量基线。覆盖同批移除又加入、manual clamp、journal gap、reset。
3. GPU 成员包含退出动画 hold 段：stage exited 不能立即释放槽位，等 fade
   完成，并合并 overlay/hold 的真实增减。
4. 增量按 ID 更新、填空槽和尾部交换；失配走同一 canonical 全量同步。保持
   id→slot、dense prefix、positionsChanged 和 dirty ranges。
5. **保留 published 的不可变快照契约。** 第一版可继续复制数组，只消除全量
   比较/Map 扫描，并保留这部分 O(N) 成本。只有复制仍是热点，才单独设计
   版本化读取或持久化数据结构、审计所有身份依赖；不能直接返回原地修改的
   工作数组，也不能先宣称整个路径已为 O(churn)。

**回归：** `geometry/cellSlotAssignment.test.ts`、`geometry/cellRenderSet.test.ts`、
`geometry/cellRenderSetUnresolved.test.ts` 与 CellGalaxy/picker 测试。随机增删、
重入、payload-only、hold、overlay、重排、断链对比 canonical；旧快照不变，
当前点击读取最新 payload，位置未变不全量重新投影。

**退出条件：** 单项维护访问量与总 Cell 数解耦，上传仍只覆盖必要槽位；单独
报告保留的复制成本。若改变快照接口收益不足，记录为剩余成本，不扩大重构。

### 10. S6：浏览器与长时间验收

使用 production build、固定快照/事件 nonce/模拟时间/相机。生产检查面板在
主 dashboard 验证，proof Lab 不能代替。遵循
[VISUAL_REVIEW.md](../../ui-app/VISUAL_REVIEW.md) 的启动、字体和 ready marker。

| 维度 | 最低覆盖 |
|---|---|
| 规模 | 12K 默认；50K 压力需实际数据和 display budget 支持，不能只改前端标签 |
| 视口 | 面板矩阵 1920×1080、1920×920、1440×900、1280×800、1180×663、820×1078 |
| 质量/像素 | 标准视口 High/Med/Low；High 的 DPR 1/1.5/2，其余记录质量限制后的实际 DPR |
| 动作 | 空闲、orbit/阻尼（移动期 leader/标签不闪回、停稳后恢复延迟）、2/3/4 面板开关、resize、hover 与 pointerdown |
| 链事件 | 普通区块、突发、backfill/replay、reorg、协议活动、memory recall |
| 恢复 | Worker 失败/超时、隐藏/冻结后恢复、暂停/继续、卸载重挂、reduced motion |
| GPU 路径 | 参考设备硬件加速；可用时补另一浏览器/iGPU；软件 GPU 只作相对/功能验证 |

1. 每次记录 CSS viewport、drawing buffer、请求/实际 DPR、quality、实际数量、
   浏览器/GPU 路径、频率/电源状态。开 `render-stats=1` 分析 pass 和计数，
   关闭该 query 与 GL·08 后另测帧率；MSAA 下探针会改变成本。timer query
   不可用时写“未知”，不写 0。
2. 主场景 GPU bracket、画像额外 pass、DOM 合成、MSAA resolve 分开归因。
   记录 `__renderPerformanceStats()`、`__blockFrameStats()`、`__fabricStats()`、
   `__pulseStats()`、`__uploadStats()`、`__cellPickStats()`。只有 profile 证明
   透明层、population 或 lens 仍占主导，才追加对应材质优化。
3. 至少三次同条件配对。idle、motion、block landing、cold boot 分开统计；
   GPU 时钟不同按 Canvas 文档对齐/归一化，不直接比平均 FPS；固定质量，
   避免 adaptive 选择不同画质掩盖退化。
4. 无损优化在确定性场景要求 RMSE 0、changed-pixel count 0，包含 idle 和
   active；可见变化单列前后截图与受影响契约，不能悄悄更新 golden。
5. 至少 30 分钟真实增量回放与反复开关面板，穿插后台/前台切换。比较预热后
   heap、geometry/material/texture、Worker/job/监听器数和缓存容量轨迹，
   检查无持续增长、无旧 generation 残留，区分有界缓存预热与泄漏。

**退出条件：** 每项性能主张有同条件前后证据；事件、选中身份和视觉契约无
回归；未执行的浏览器/设备场景明确列出。已有性能收益不能抵消 correctness
回归。

### 11. 检查、交付与回退

实施时先跑阶段相关 Vitest 文件，阶段结束执行前端完整检查：

```bash
pnpm test
pnpm typecheck
git diff --check
```

最终按 [开发构建门禁](../development.md#build-and-test) 完成：

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
cargo build --release -p cknerv-cli
```

涉及 Worker 打包、SPA boot 或 CLI 接线时，执行
[CLI smoke](../../crates/cknerv-cli/SMOKE.md)，验证嵌入页面、两类 snapshot、tip
推进、退出持久化与端口释放；发布构建不使用 `CKNERV_SKIP_UI_BUILD=1`。
本次实现修改生产 UI、Worker 恢复与 SPA 打包路径，因此执行全部前端与 Rust
门禁、release build 和隔离工作目录下的 CLI smoke；结果记在下节。

每个变更单元交付：问题与最终行为、影响范围、正确性/视觉结果、同条件性能
对比、最慢单步与总落地延迟、状态迁移说明。改变性能/调度契约时同步更新
`docs/canvas-rendering.md`；内部 Worker 协议变化同步对应 TS 测试。

按阶段回退实现，不清空用户派生状态；保留其他已验证的独立变更，不长期维护
“旧算法失败再试新算法”的双路径。完成记录分别列实现、功能测试、浏览器性能
和视觉验收，不以其中一项通过代替全部完成。

### 12. 执行清单

- [x] S0：可复现基准与最小观测已落库；浏览器硬件计时归入 S6。
- [x] S1：等价剪枝、完整可恢复求解和安全临时路线已完成并正式复测。
- [x] S2a：bridge 三段均可恢复且不发布部分结果；配对选择基准与完整冷管线已复测。
- [x] S2b：总预算、plan/panel 预留、防饿死、独立 Lab 生命周期与超支原因记账。
- [x] S3：Worker 恢复可响应、可取消并退避；release SPA 验收归入 S6。
- [x] S4：mote 有效范围与稀疏上传已实现并经真实软件 WebGL 验证。
- [x] S5：Cell 槽位增量化，保留并单独报告不可变快照复制。
- [ ] S6：已完成两组硬件配对、非全笛卡尔矩阵和含前后台切换的 30 分钟 soak；第三组配对、校准 GPU 计时、完整矩阵/事件与 50K 实际展示仍未执行。

### 13. 2026-09-11 执行记录

| 阶段 | 已执行 | 证据与未完成项 |
|---|---|---|
| S0 | 新增 `packages/ui/benchmarks/rendering/` 与 `benchmark:rendering`；JSON 记录 commit、dirty 标志、相关源码 SHA256、seed、环境、规模、分位数、操作量、切片/模拟 60 Hz 延迟，并支持 metadata-only。单 payload 每次使用新的 Cell 对象；commit 由 `git rev-parse HEAD` 读取。新增 `cpu.inspection.layout-slice` 与 `__constellationWorkStats()`。完整 12K/50K CPU 记录为 `/tmp/cknerv-rendering-cpu-final-20260911.jsonl`，测量源码 SHA256 `3bdd83766199441d5fddf10fd77ea3848fdba4f85e0239bd021d51fe7db6864e`；最终 runtime 的 S1 补测为 `/tmp/cknerv-rendering-cpu-final-s1-runtime-20260911.jsonl`，dirty source SHA256 `694821507ad5b408a02354431774b49b389f269e736c59d5bbf9c4e707dcfcf7`。浏览器生命周期修复后的最终 QA 候选 metadata-only source SHA256 为 `979c37deeccb26434df885b22a113f2ea9f639d4d17265e0e844cc93a1568c8c`，未把三者伪装成同一版本。 | Node 微基准不含 DOM/GPU。初期基线页面功能检查只使用独立 headless Chromium + ANGLE SwiftShader；之后的硬件配对与矩阵另记在 S6。页面 API 代理的 runtime build 标签是旧服务端值，未作为静态包版本证据。 |
| S1 | 候选评分只算一次并稳定保留前 12；路由排列缓存；endpoint hoist；fast route 用可证明下界剪枝；orthogonal search 用已验证 incumbent 与分段预检减少分配。同步 API 与 Canvas cursor 共用 canonical generator；候选、route order、端点对和正交网格均可让出。请求冻结，geometry 变化取消，anchor 漂移合并；只有 latest canonical 发布。locked cursor 恒用 1.6 ms 片且从不强制排空；静止状态的几何变化期间只显示通过当前 panel identity、viewport、endpoint、正交、HUD/chip/reticle、route 和 label 校验的临时路线。实际 camera pose/projection 移动由组件内 CSS-pixel detector 控制：leader/标签持续隐藏、cursor/预算释放、reticle/name chip 追踪，至少 3 帧且 80 ms 内累计漂移 ≤0.02 px 后以最新几何恢复。清 connector signature 防同 key 不恢复；panel close 会立即清 portrait seat，新选择保留已完成 panel seat 但不复用 route。 | 88 场景旧输出 oracle 已对 2,663,687 bytes 逐字节一致（SHA256 `9c260118…`）；1890 个临时平移审计无悬空 endpoint、斜线或相交。新交互前的最终 runtime 空窗四面板持续移动外层 p50 1.71/p95 2.28/max 8.97 ms，停止后 8 帧回到 canonical；120 帧中 17 帧无安全路线、最长连续 9 帧，22 次 current canonical 落地、81 帧使用已验证临时结果。该视觉代价促成移动期明确隐藏规则，历史数字不能直接当作新版性能结论。新版行为测试覆盖 damping 单次恢复、累计 position/direction/projection、同 key、新选择、单 panel/specimen 关闭；production 浏览器恢复延迟另记。逐次等待 canonical 的历史单片 p50 1.71/p95 2.00/max 9.72 ms，落地 p50 5/p95 7 帧；记录为 `/tmp/cknerv-rendering-cpu-final-s1-runtime-20260911.jsonl`。 |
| S2a | host sync、候选选择和 stroke reconcile 都是 wall slice 下的可恢复 cursor；arm 以原子 version tag 捕获同代不可变 Cell/edge；selection 用完整 53-bit ID tie-break 的 heap；anchor bucket 每 32 次访问可中断，并只保留全局最佳 32 个候选再排序；cache 改为有界逐项淘汰；reconcile 在 commit 时处理跨片 reap。 | 最终 12K cold pipeline 95.49 ms / 38 slices / 模拟 633 ms，slice p95 8.74/max 9.42 ms；50K 为 118.15 ms / 53 slices / 模拟 883 ms，slice p95 4.46/max 6.33 ms，均未完全达到 p95 4 ms 目标。选择器 12K cold p50 35.42 ms、warm p50 1.71/p95 3.94 ms；50K cold p50 87.86 ms、warm p50 18.61/p95 29.03 ms。独立同进程交替旧/新选择器：cold p50 37.77→31.97 ms，warm p50 3.50→2.11 ms，1600 edges 逐字节相同。总 CPU、切片时长和模拟调度延迟分别报告。 |
| S2b | ledger 改为总实际花费加显式 reservation；plan 与跨帧 panel cursor 预留，deadline consumer 不被较低优先级估计误差饿死；frame token 让 NeuralNetwork owner 与独立 Lab 幂等开账；记录 forced reason、estimate overshoot 和 overspend。 | `drain=8, reserve plan=4` 时 bridge 被推迟、plan 获准，总计 12 ms；同帧 panel + block、estimate undershoot、释放/重置均有行为测试。实际超支只在有记录的 reservation/starvation/估计误差或 locked deadline 路径发生。 |
| S3 | 同一 canonical neighbor/passive generator 同时供同步、Worker 语义与主线程恢复；密集 bucket、孤立点、lifeline、component stitch、BFS 已访问尾扫、arbor、排序和 packing 内层 yield；MessageChannel task、共享 ledger、隐藏暂停、1–30 s Worker 退避、latest-only cancel 和 pending-task 清理。恢复使用不可变请求 Cell 发布。 | 10 场景 topology oracle 对 5,050,357 bytes 逐字节一致（SHA256 `1746cd9b…`）。最终故障注入：12K 总 804.34 ms、301 slices、max slice 4.86 ms、max generator step 4.32 ms、heartbeat max gap 59.09 ms；50K 总 7.40 s、2952 slices、max slice 14.44 ms、max step 12.86 ms、heartbeat max gap 31.57 ms；pending max 均为 1。12K 较原约 2 s 阻塞显著改善，但离群仍超过 4/50 ms 目标，不能宣称硬实时上限。 |
| S4 | drawRange 为 `marks × 96`，布局提交与属性写入同一 layout effect；mote 与 lens 动态 lane 标记 cohort 范围并合并；首次 GPU buffer 创建回调清掉初始化 range。 | 独立 ANGLE SwiftShader WebGL 对照 9 场景 changedBytes=0、RMSE=0、`glError=0`；7 组 draw 6144→672，单 gulp 24576→384 B，相邻两组 768 B，mass 384 B，7→2→7→0→1→64 像素一致。未测硬件 GPU 时间。 |
| S5 | 相邻 render journal 原子校验后按 removed/upsert 增量维护；invalid journal 在任何 mutation 前回退；中间+尾部删除清理所有映射；hold/overlay 继续 canonical；published 仍复制。 | 最终 12K 单 payload：100 次共 100 次 Map get，p50 0.011 ms；50K p50 0.157 ms。随机 1500 步、2^52 ID 与 canonical 输出逐步一致。O(N) published copy仍是明确保留成本。 |
| S6 | 基线归档页面先以 SwiftShader 验证 1180/1440 resize、真实 Cell 选择/关闭 specimen、WebGL2 `getError=0` 和单 renderer。随后在 ANGLE AMD Radeon 890M Vulkan/radv、1180×663 DPR1 High、同一真实 12K fixture/Cell/三面板完成两组旧 `e49ac7e3`→候选 30 s idle + 30 s motion 配对：motion p95 66.7/66.6→33.4/16.8 ms，long tasks 126/30→1/0；候选 leaderless 为 6/1502 与 402/1756，旧版为 0，现已由移动期隐藏规则取代。六视口、DPR1/1.5/2、High/Med/Low、同 Cell 3→2 panel、长 analysis、reduced motion 矩阵已执行但非全笛卡尔积。30 分钟 live soak 为 31 samples、tip +199，含 11 个 hidden samples 后恢复；Worker/context 各 1，末段前台 heap 49.47–52.08 MiB，资源/监听器稳定，12 次真实选择关闭无残留，0 uncaught/GL/HTTP 错误。 | 配对只完成两组；第三组在身份校验/后续 CDP 超时中止。旧候选 source SHA `979c37de…`，因此其性能数字不能直接外推到新 motion gate。没有校准 GPU timer 或离线主线程归因，宿主负载未控制；未执行完整事件笛卡尔积、另一浏览器、四面板真实浏览器或 50K 实际展示。soak 含前后台切换，不是 30 分钟连续前台 GPU 负载；2 个 cancelled fetch 与 6 个 WS error 对应 intentional freeze/BFCache，恢复后 tip/updates 继续。证据：`/tmp/cknerv-canvas-review-20260911/hardware-paired-final-results.json`、4 个 trace.gz、`current-lifecycle-final.json`、`-soak-samples.json`、`-lifecycle-cycles.json`、`-matrix-states.json`。不能宣称完整视觉或实机 FPS 验收完成。 |

新 motion 规则之前的最终前端 `pnpm test`、`pnpm typecheck` 与
`git diff --check` 均通过。同期 Rust `fmt`、`clippy -D warnings` 通过；
`cargo test --all` 前两次完整运行各有一个
adapter 三秒时钟断言失败，对应精确单测复跑均通过，第三次完整运行通过，故保留
首次失败事实而不写成首轮全绿。同期 `cargo build --release -p cknerv-cli` 通过，
release smoke 使用隔离目录
`/tmp/cknerv-render-smoke-lifecycle-final-20260911`：两类 snapshot 契约与嵌入
SPA 200 已验证，hydration 后 tip 从 20423312 前进到 20423317，Ctrl-C 以 0
退出并持久化 39 MiB state，端口 17001 随后拒绝连接。

新增 motion leader gate 后，完整 `pnpm test`、`pnpm typecheck`、
`git diff --check` 和 SPA production build 通过。随后浏览器发现惯性中切换
Cell 时 fresh panel host 会在 `(0,0)` 淡入，最终修复按具体 DOM host 记录
定位状态：未定位 host 保持隐藏，画像只使用当前可见且已定位的 specimen。
该补丁后运行 4 个相关 Vitest 文件、258 项测试，以及 `pnpm typecheck`、
SPA production build 和 `git diff --check`，均通过；没有再运行全量
`pnpm test`。测试覆盖 damping 到单次停稳、累计 position/direction/projection
变化、motion 内零 route 操作、leader ref 重挂、同 connector key、新选择
共享 tracker、单 panel/specimen 关闭，以及 fresh host、新 slot、首次选择、
同 key host 替换和卸载。此次是 UI-only 修改，没有重新运行 Rust 门禁、
release CLI build 或 smoke。

最终 motion 规则的独立生产浏览器功能复测使用 bundle `index-BCFFvzl6.js`，
ANGLE AMD Radeon 890M Vulkan/radv、High、固定真实 12K snapshot，采样
1,621 个 rAF。所有运动段均无可见 leader，连续运动采样之间 routeOrders/
cursorSlices 无增量，也没有未定位但可见的 panel。既有面板保持显示；按住
鼠标但相机静止、wheel、1440×900 DPR2 resize、同 Cell 3→2 panel、再次
拖动、惯性中切换到新 Cell `5390670170535184`、关闭全部均通过。截图确认
切换期间 fresh hosts 隐藏、停稳后正常显示，无 `(0,0)` 面板闪现或漂浮画像。

从应用的 settled 标记到全部 leader 恢复，普通 orbit/held/wheel 为同一
采样帧，resize 为 83.4 ms/3 个 rAF，双面板恢复为 66.6 ms/3 个 rAF，
切换 Cell 为 150 ms/4 个 rAF。该计时不包括进入 settled 前的实际惯性，
也不是独立的物理停稳判定。已记录的静止布局在 viewport、正交线段、endpoint
落在对应 panel 边界、路线不穿过其他 panel 内部的检查中均无问题；运动
截图中 route label 均隐藏，所有 stage 的 WebGL `getError=0`，0 uncaught。
两次 enrichment 404 对应固定 fixture 未收录的新 Cell/transaction，未作为
完整实时 API 验收。本次未注入新 tip/event，也未测新的 FPS、CPU/GPU 收益，
不能沿用前述旧 source SHA 的性能或 soak 结果。

证据保存在 `/tmp/cknerv-canvas-review-20260911/` 下的
`motion-policy-final-seated.json`、`motion-policy-final-seated-summary.json`
及同名前缀的阶段截图。State/purge required：**no**。下一步仍按 S6 补齐
新版本的性能配对、校准 GPU 计时和未覆盖场景。
