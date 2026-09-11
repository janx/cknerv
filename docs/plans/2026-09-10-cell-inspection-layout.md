# Cell 检视布局与连线改进计划

日期：2026-09-10。状态：已实施；Chromium 实景核心流程通过，WebKit、DPR 2 与完整生命周期矩阵未执行。

## Goal

- Cell 位于中心、边缘或角落时，CELL SCAN、SCAN·01、SCAN·02 都有清楚的
  排列关系，用户能立即辨认它们共同指向的 Cell。
- 连接线及编号不遮挡面板内容、透明形态视窗或 Cell 名称。
- 阅读期间保持面板位置稳定；空间变化时按明确规则重新排布。

## Principle Alignment

- **CKB Native**：检视内容、身份、形态和来源仍由真实 Cell 数据驱动；连接线
  表示选中对象与检视面板的关系，不增加链上关系或事件含义。
- **Local First**：使用现有 DOM、SVG 和主 Canvas，不引入布局服务、外部资源
  或第二个 WebGL context。
- **Agent Friendly**：布局、路径与标签位置由可独立测试的纯几何逻辑决定；
  输入、无解条件、缓存失效和浏览器验收路径明确。
- 改动限定在浏览器检视层。沿用点击 Cell 时相机被动、组件消费既有类型和
  缓存数据的边界，不涉及 wire types、服务端投影或持久化 schema。

## Result

- 已交付：三个独立面板与可选 trace 的整体排布、避障连线与编号、透明窗口
  遮罩、阅读位置锁定，以及覆盖边缘、角落和第四个 trace 面板的回归检查。
- State/purge required：**no**。
- 下一步：在可用 WebKit 和 DPR 2 环境补做下述未执行浏览器矩阵；当前无需迁移
  或清理派生状态。
- 本文同时保留原实施计划和文末真实执行记录；讨论中的交互示意没有作为生产
  页面验收证据。

### 1. 已确认的问题与边界

| 位置 | 当前行为 | 需要解决的问题 |
|---|---|---|
| `packages/ui/src/derives/cellConstellation.derive.ts` | 面板逐个挑选四象限，再挤开重叠并压缩高度；优先放 analysis | 高大的 analysis 可挡在 Cell 与另外两个面板之间；评分没有计算连线路径 |
| 同文件的 `constellationLeader` | 从 reticle 沿直线连到目标面板最近点 | 只看源点和目标，不知道沿途的其它面板 |
| `packages/ui/src/components/hud/CellConstellationMarks.tsx` | 连线 SVG 为 `zIndex: 1`，编号为 `zIndex: 2` | 面板未建立相应的前后层级，线和文字可能覆盖面板 |
| `packages/ui/src/components/hud/ConstellationPanel.tsx` | CELL SCAN 的主体透明，形态来自主 Canvas 的 scissor pass | 仅降低连线层级仍会从透明窗口透出；不能用不透明底色挡住形态 |
| `packages/ui/src/components/hud/cellConstellationFrame.ts` | 编号固定在线段约 52% 处；一个签名驱动所有写入 | 编号可落在其它面板上；没有把 HUD 几何、chip 高度和安全边界完整纳入失效条件 |
| `packages/ui/src/components/hudOcclusion.ts` | HUD 矩形数组原地更新，引用不变 | 不能用数组引用判断障碍是否变化 |

近似截图的几何输入已复现两条线穿过 analysis：舞台 `1920 × 920`，Cell
锚点 `(502, 485)`，analysis `440 × 717`、specimen `280 × 316`、reader
`408 × 340`，配合截图估计的 HUD 矩形。此输入用于固定回归案例，实施时还需
补充真实 DOM 测量，不能把估计值当成真实浏览器捕获。

面板保留独立高度、独立关闭、现有内容和扫描揭示顺序。没有数据字节时不创建
reader；开启因果回忆时可能出现 `trace / SCAN·03`，布局不能写死为三个对象。
本轮以现有桌面、笔记本和平板检视场景为范围；手机上的完整检视交互另行设计，
不把讨论示意中的窄屏排列直接作为生产实现。

### 2. 面板作为一组选择排列

用有限的整组候选布局替换逐个面板占位。候选根据实际可用区域判断，而非仅用
Cell 在屏幕左半边还是右半边来决定。

| 候选 | 排列关系 | 使用条件 |
|---|---|---|
| 两侧展开 | specimen 与 reader 在一侧上下分开，analysis 在另一侧 | Cell 两侧都有足够空间 |
| 向右展开 | specimen、reader 靠近 Cell 上下分开，analysis 放在外侧右列 | Cell 靠左，右侧可用空间较大 |
| 向左展开 | 向右展开的镜像 | Cell 靠右，左侧可用空间较大 |
| 上方或下方折行 | 将完整排列移入较大的上下可用区域，保留模块次序及间隔 | 两侧无法容纳，需要利用横向空间 |

同一候选里的面板仍是独立矩形，不共享高度，不用填满列高的空白来对齐。
`trace` 有自己的候选位置、连接线和高度预算，参与同一次求解。关闭任一面板
只移除其空间占用和连接关系，优先保留其余面板原位。

布局选择采用分级判断，避免把不可接受的遮挡折算成少量评分后接受：

1. 排除越出安全边界、面板相互重叠、盖住 reticle 或名称的候选。
2. 给候选生成接点和路径，排除连接线穿过面板或标签压住内容的候选。
3. 在可行候选中优先保持当前排列，其次减少 HUD 覆盖、内容压缩与移动距离；
   按固定顺序取第一个可完整路由的候选。每条路径内部选择有界通道中的最短
   可行路线，输出可复现。

初始间距目标为 24px；紧张布局可退到现有 16px 下限。沿用现有 Cell 留白区
与 reticle 核心的区别：外围留白可适量收缩，reticle 和名称不可覆盖。
这些参数集中定义，不能在组件中各自补常量。

空间不足时，先对 analysis、reader、trace 分配可读的有限高度，让它们内部
滚动；specimen 保留完整窗口。仍不成立则尝试另一套整组候选。返回结果应能
区分正常布局、压缩布局和无可行布局，不能把重叠最少的答案标成成功。
在验收范围内出现无解即视为未完成，继续调整候选及高度分配，不以裁掉内容、
缩小字体或自动隐藏已打开面板通过验收。

### 3. 连线、编号与遮罩

布局结果同时产出每个面板的边缘接点、路径、标签矩形和遮罩矩形，DOM 端只
消费这一份结果，不另算一套坐标。

- 接点优先选择朝向 Cell、具有入线路径的边缘。较远的 analysis 可以利用
  specimen 与 reader 之间的空隙接线，不强制连接最近角点。
- 直线畅通时保持直线；否则沿障碍边界外的走线空间生成折线。路径优先零至
  两个转折，初版最多三个转折；超出上限则拒绝该候选布局。
- 障碍包括全部已打开面板、Cell 名称、非目标 reticle 区域、已放置标签和可见
  HUD。线宽、底衬和标签留白均计入安全距离。不同连线在 reticle 处分配有序
  出口，在可行空间内保持互不交叉。
- 编号优先放在接点前最后一段足够长的空白处，不再使用固定中点。标签本身也
  参与避障；末段不足时重新选接点，全部不足则把该编号放入对应面板的标题，
  同时移除线上重复编号。每个已打开模块只有一个编号。
- 同一检视层内明确绘制次序：连线与线上编号在面板之下，reticle 与名称清楚
  可见；连线和装饰不接收指针事件。
- SVG mask 裁去面板、名称和 HUD 的遮挡区域；包含 CELL SCAN 的整个透明
  窗口，不能只遮标题。线条、深色底衬和发光都不能漏入窗口；接点在预留的
  面板外缘结束。标签必须完整显示，不能靠 mask 截去半个编号。
- 遮罩是防穿透保障。验收仍检查可行场景的完整无障碍路径，不能用被裁成几段
  的直线代替路径规划。

保留现有颜色和扫描强调语义，本轮不额外引入 hover 高亮、拖拽面板或线路动画。
路径求解只面对有限面板与 HUD 矩形，不引入全画面栅格搜索或布局依赖。

### 4. 锁定阅读位置与正确失效

将当前仅记录各面板 quadrant 的锁扩展为整组排列及实际位置的锁。相同 Cell
下，原布局仍有效时保持面板坐标，只更新 reticle、名称和连线起点；路径也优先
保留已有走线方向，避免微小移动触发反复改道。

| 变化 | 行为 |
|---|---|
| Cell 在有效留白范围内缓慢移动 | 保持面板位置；只更新必要的标记和连线 |
| 切换 Cell | 清除上一选择的布局锁，按新锚点求解 |
| 窗口或安全边界变化、HUD 开关及位置变化 | 失效并重新验证整组布局 |
| 面板增减、内容测量或字体尺寸变化 | 更新输入，优先在原位置调整高度及滚动区 |
| 锚点进入面板保留区、原走线路径不可达 | 立即重新求解，安全约束优先于位置锁 |
| 滚动正文、操作面板控件或拖动形态视窗 | 可行时维持被操作面板的位置与滚动进度 |
| Cell 离开或重返视锥、关闭与重新挂载 | 沿用整体显隐和退出生命周期，恢复时验证几何并正确重写 |

分开维护布局输入、连线输入和 DOM 写入签名。布局输入包含舞台宽高、safeTop、
edge、面板存在状态与测量宽高、chip 宽高、标签尺寸以及 HUD 障碍几何版本。
HUD 数组原地更新也必须触发失效，可在现有测量 store 中发布递增版本。

测量继续放在布局阶段或 ResizeObserver，禁止在 R3F 帧回调新增 DOM 布局读取。
常态帧只做投影、有效性检查及必要的坐标写入；整组候选搜索不随每个亚像素变化
重复执行。复用已有半像素量化与 scratch 数据，给候选数量及路由搜索设置边界。

保留 specimen 的主 Canvas scissor 与 origin 通道，保证 DOM 窗口、清屏区域
和形态实际绘制位置一致。相机不因选中 Cell 或重新排布而移动；既有 portrait
指针捕获、ESC、外部点击和 HUD 局部降亮清理均需继续有效。

### 5. 实施顺序与文件范围

| 步骤 | 工作 | 主要文件 | 完成条件 |
|---|---|---|---|
| 1 | 固定截图近似案例，补真实面板/HUD 测量与穿线检查 | `packages/ui/__tests__/derives/cellConstellation.derive.test.ts`、现有 frame 测试 | 能复现两条线穿 analysis，并区分面板重叠与连线穿越 |
| 2 | 明确层级，加入透明窗口等遮罩与生命周期清理 | `CellConstellationMarks.tsx`、`ConstellationPanel.tsx`、`cellConstellationFrame.ts` | 文字、透明形态窗口不再被线与底衬覆盖；关闭后无残留 |
| 3 | 实现整组候选、接点、避障路径和编号布局 | `cellConstellation.derive.ts`；必要时新增同目录 `cellConstellationRouting.derive.ts` | 三面板及 trace 在验收几何范围内可行，短路径不穿内容 |
| 4 | 接入整组位置锁、输入版本、分开的写入签名 | `cellConstellationFrame.ts`、`CellInspectionOverlay.tsx`、`hudOcclusion.ts` | 缓慢漂移不移动面板，HUD/内容变化不留下过期布局 |
| 5 | 完成真实浏览器、交互和嵌入式页面验收，同步设计契约 | 下述测试文件、`docs/canvas-rendering.md`、`ui-app/VISUAL_REVIEW.md` | 验收矩阵与构建门禁通过，文档描述最终行为 |

表中的组件文件均位于 `packages/ui/src/components/` 或其 `hud/` 子目录。
必要时调整 `CellDetailPanel.tsx` 传递实际已打开模块和交互状态；不重排语义内容。
`SVGLineElement` 改为路径后同步更新 handles 与 DOM 测试，删除旧直线及逐面板
求解的生产调用，保持一个规范的布局入口，不保留新旧算法串联兜底。

### 6. 自动化回归

优先扩展现有测试：

- `packages/ui/__tests__/derives/cellConstellation.derive.test.ts`：保留现有
  平板密集锚点扫描，增加整组顺序、路径和编号约束；根据新契约改写“每个面板
  必须在不同 quadrant”之类的旧实现断言。
- `packages/ui/__tests__/components/hud/cellConstellationFrame.test.tsx`：检查
  面板不动时连线仍更新、原地修改 HUD 障碍后的失效、chip 高度单独变化、
  挂载与卸载重写，以及不同签名只触发对应 DOM 更新。
- `packages/ui/__tests__/components/CellInspectionOverlay.dim.test.tsx`：逐面板
  降亮 HUD，不按整组包围盒扩大降亮范围；透明窗口与关闭恢复正确。
- `packages/ui/__tests__/components/CellInspectionOverlay.memo.test.tsx` 及现有
  detail/portrait 测试：确认流数据更新不重新挂载检视、扫描时钟或形态窗口。
- 必要的 marks 组件测试：编号只出现一次、mask 与模块增减同步、装饰不拦截
  指针。实际叠层和透明窗口合成由浏览器确认，jsdom 断言不能代替截图。

几何组合至少包括九个锚点区域、无字节的两面板、有字节的三面板、带 trace 的
四面板、关闭后的单面板与零面板、短正文和最长实际正文。以线段对扩张矩形的
相交检查验证整条路径；不仅比较起点和终点。编号矩形、线间交叉、视口边界和
reticle/name 保留区分别断言。加入边界附近的连续轨迹，验证锁定与释放没有抖动。

### 7. 浏览器验收与门禁

使用同一份捕获的真实快照及固定 Cell 身份做前后对照，包含截图中的富内容
Cell、无字节 Cell 和可打开 trace 的真实 Cell。按
[Visual Review 工作流](../../ui-app/VISUAL_REVIEW.md) 等待启动遮罩退出及字体
就绪。现有 proof Lab 不能代替生产 CellInspectionOverlay 的布局验证；需要
可重现定位时，在本地 review 路径使用生产 overlay 和受控投影，不改 Cell 数据。

| 维度 | 范围与通过标准 |
|---|---|
| 视口 | `1920×1080`、`1920×920`、`1440×900`、`1280×800`、`1180×663`、`820×1078`；全部以 CSS px 记录，桌面补 DPR 2，平板包含 Safari/WebKit |
| 位置 | 中心、四边、四角，以及 Cell 从中心移动到边缘的连续轨迹；面板和编号可读，路径不穿面板 |
| HUD | 默认布局、部分关闭、检视打开期间切换；布局能识别障碍变化，只降亮实际被面板覆盖的 HUD |
| 内容 | 两/三/四面板、短/长正文、enrichment 后到、字节与回忆内容展开；无覆盖、空洞撑高或丢失内容 |
| 交互 | 正文滚动、复制、形态 orbit、独立关闭、切换 Cell、ESC、外部点击；无误关、跳位或指针捕获残留 |
| 合成 | 高亮星云背景下，线条底衬、端点和编号不进入透明形态视窗；视窗中的形态持续绘制且位置准确 |
| 生命周期 | 连续选择至少十个 Cell，包含视锥外再进入、关闭期间切换；无不可见面板、旧 mask 或旧连线 |
| 动态与性能 | 正常/reduced-motion、High/Med/Low 下关系一致；慢速漂移只更新必要部分，无新增帧内布局读取或持续整组搜索 |

保存代表性截图和几何记录：CSS 尺寸、DPR、Cell id、锚点、各面板实际矩形、
模板标识、路径点、标签矩形及压缩状态。桌面中心、截图靠左、左右角落、平板
横纵向和 trace 至少各有一份记录。用相同快照、相机和质量比较检视开启前后的
运行情况，不把不同场景的 FPS 直接比较。

实现完成后执行 [Canvas 构建门禁](../canvas-rendering.md#191-automated-checks)：

```bash
pnpm test
pnpm typecheck
pnpm -F cknerv-ui-app build
cargo build --release -p cknerv-cli
git diff --check
```

新 release binary 在隔离的临时 workdir 和可用端口启动，完成至少一次真实
Cell 检视与独立关闭，确认嵌入式资源为新版本，随后正常退出。若实现进一步触及
CLI、server、adapter、持久化或 SPA boot path，则补齐 AGENTS.md 规定的 Rust
门禁及 [CLI runtime smoke](../../crates/cknerv-cli/SMOKE.md)。实际执行结果与未执行
范围记录如下，不将未取得的浏览器证据标为已通过。

## 实施记录（2026-09-11）

### 已交付行为

- `cellConstellation.derive.ts` 现在一次求解全部已打开模块，覆盖侧列、混合折行、
  紧张布局压缩和四面板 trace；specimen 保持完整正方形。有限通道路由最多三个
  转折，使用有序 reticle 出口，并验证面板、名称、reticle、HUD、标签和线路间
  的完整线段关系。
- frame 分开维护布局、连接、DOM 位置和 mask 签名。Cell 缓慢漂移时保留座位，
  锚点、名称或 HUD 原地矩形变化仍会更新路线及遮罩；零面板也继续更新选择标记
  并清理 portrait origin。
- leaders SVG 明确覆盖完整舞台，线路位于面板下方，mask 裁掉面板、名称和实际
  可见 HUD。透明 CELL SCAN 继续使用主 Canvas portrait/scissor 通道。
- 每个模块独立关闭；关闭后 slot、leader、mask 与 scissor 同步，切换 Cell 会
  重置关闭集合而不会重启其余模块的扫描时钟。相机选择行为保持被动。

### 自动化与构建结果

- `pnpm test`：通过（types、cache、UI、ui-app；最终完整日志
  `/tmp/cknerv-cell-layout-pnpm-test-final.log`）。
- `pnpm typecheck`：通过（最终完整日志
  `/tmp/cknerv-cell-layout-typecheck.log`）。
- `pnpm -F cknerv-ui-app build`：通过；最终 source 的 release 内嵌 bundle 为
  `index-BCiUoIT0.js`。
- `cargo build --release -p cknerv-cli`：最终 source（含 specimen
  `border-box` 修复）通过，耗时约 4 分 03 秒（日志
  `/tmp/cknerv-cell-layout-release-verified.log`）。
- 纯几何回归覆盖六种视口、九个锚点和三/四面板共 108 组；最终 108/108 有
  面板与完整路线。另有 screenshot、tablet HUD、连续漂移、独立关闭、A→B→A、
  零面板、mask 和标签尺寸失效回归。

### 真实浏览器证据与限制

- Chromium production/Vite：`1920×920` 三面板截图
  `/tmp/cell-layout-1920x920-click-1008-507.png`；SVG 为完整 `1920×920`，
  三条关系线与透明窗口层级清楚。此图没有等待 scan locked，不作为完整内容证据。
- Chromium production/Vite：`1180×663` 独立关闭 analysis 后截图
  `/tmp/cell-layout-1180x663-click-620-365-close-analysis.png`；Cell 选择、reader、
  specimen 与两条重排路线保留，关闭模块及其线路消失。
- release binary 的隔离实例运行于临时 workdir 和端口 `17019`。完成态捕获
  `/tmp/cell-layout-embedded-1920x920-click-1008-507-ready.png`，几何记录
  `/tmp/cknerv-cell-layout-embedded-browser.json`：真实 Cell
  `6533233974368811`，scan state 为 `locked`，xUDT reader 为 complete，
  CAPACITY、DATA、ORIGIN、三个独立面板及透明窗口均可见。
- embedded `1180×663` 独立关闭证据
  `/tmp/cell-layout-embedded-1180x663-click-620-365-close-analysis-ready.png` 与
  `/tmp/cknerv-cell-layout-embedded-close.json`：analysis 关闭后真实 Cell
  `127642`、specimen、reader 与两条路线保留，reader 为 COMPLETE，SCAN·02
  在紧张路线下只回退到标题一次。
- Chromium/Vite 真实偏左 Cell `5092134740654620` 的几何记录：reticle 中心约
  `(709,527)`，`scanState=locked`，normal/distributed 三面板及三条路线完整；
  修复后 scan window 为 `279×279`，处于 `280×313` specimen host 内。完整
  Canvas 截图 `/tmp/cell-layout-vite-1920x920-left-ready.png` 与几何记录
  `/tmp/cknerv-cell-layout-left-clean-final.json` 均保存，未观察到线路穿面板或
  透明 specimen。
- 受限高度完成态截图
  `/tmp/cell-layout-vite-final-1180x663-click-620-365-ready.png` 与几何记录
  `/tmp/cknerv-cell-layout-scroll-final.json`：真实 Cell `127642` 为
  locked/compressed/split-right；analysis 高 `253.48px`，`scrollTop 381 +
  clientHeight 220 = scrollHeight 601`，确实滚至底部，ORIGIN footer 位于可见
  panel 内。scan window 为 `279×279`，完整处于 `280×313` host 内。
- `820×1078` Chromium 图 `/tmp/cell-layout-820x1078-click-430-593.png`
  验证了压缩折行、完整 specimen 和三条路线，但捕获时数据为 `DATA FROZEN`，
  因此只作为加载态证据，不标记为长内容完成态通过。
- release smoke 使用的是其构建时的 `index-CEsXX0Ve.js`；之后只移除了未生效
  的跨候选路线评分，并修复 specimen 的 `box-sizing`，最终
  `index-BCiUoIT0.js` 已重新完成 release gate，但没有将旧截图描述为新 bundle
  的 embedded 捕获。
- 隔离实例在临时 workdir `/tmp/cknerv-cell-layout-smoke-grtmye4m` 和端口
  `17019` 启动；tip 从 `20419442` 推进到 `20419525`，两个 snapshot shape 正确。
  Ctrl-C 后进程 exit 0、端口拒绝连接，并保存有效的 40,479,046-byte state
  （tip `20419532`）。日志为 `/tmp/cknerv-cell-layout-embedded-smoke.log`。
- WebKit/Safari、DPR 2、reduced-motion/质量组合、十次连续选择和视锥离开再进入
  未在本环境执行，均不标记为通过。

State/purge required：**no**。没有 wire、服务端、持久化或链状态形状变化。
