# 启动加载体验改进计划

日期：2026-09-09。状态：已实施。

## Goal

- 页面收到 HTML 后即呈现有视觉主体的启动画面，覆盖主 JS、初始数据和
  Canvas 准备期间的等待。
- 用户能区分仍在下载、暂时没有响应、准备画面和加载失败，并能主动重新加载。
- 从启动画面平滑进入真实场景，快网及时进入，慢网持续反馈。

## Principle Alignment

- **CKB Native**：加载图形属于展示装饰；Cell、节点、连接、计数与活动继续
  来自真实快照和增量。快照历史不触发实时活动动画。
- **Local First**：使用随 CLI 分发的 HTML、CSS、SVG 和现有字体，无新增外部
  资源请求、服务依赖或浏览器持久化数据。
- **Agent Friendly**：启动状态、交接条件、重试行为和验收路径有明确契约，
  使用可测试的状态决策和可查询的 DOM 标记。
- 保持两份初始快照就绪后挂载正式 App 的数据边界；改动限定在浏览器启动和
  展示层，服务端 API、Rust/TS wire types、缓存 reducer 与持久化 schema 保持现有契约。

## Result

- 已交付：轻量静态启动画面、独立于 React 挂载的交接生命周期、按实际请求
  attempt 记录的真实进度、等待与失败反馈，以及对应的回归检查。
- State/purge required：**no**。
- 下一步：按发布流程审查并合并；无需迁移本地状态。
- 本轮聚焦加载体验。快照请求提前、传输压缩、分批快照与浏览器缓存作为后续
  性能工作，依据测量结果另定范围。

### 1. 已确认的现状

| 位置 | 当前行为 | 对本次改动的约束 |
|---|---|---|
| `ui-app/index.html` | 静态启动条在 `#root` 内，主模块运行前只有这条读数 | 视觉主体必须随 HTML 到达；启动层需要独立保留 |
| `ui-app/src/main.tsx` | 静态导入 App；两份快照并行完成后调用 `root.render` | React 挂载和真实画面出现是两个时刻 |
| `ui-app/src/boot-shell.ts` | 驱动静态条；节点消失时结束订阅 | 需要显式管理交接、失败和清理 |
| `ui-app/src/connect.ts` | Cells 响应按字节读取；二进制不可用时回退 JSON | 保留回退能力；等待检测必须观察每个实际请求 |
| `packages/ui/src/boot/bootSequence.ts` | 阶段独立且终态不可逆；下载字节保留高水位 | 跨请求高水位不能作为当前下载进度或停滞判断 |
| `packages/ui/src/boot/BootFrameSentinel.tsx` | `first_light` 需要有 Cell 且连续 10 帧小于 40ms | 不能直接用它作为启动遮罩唯一的退出条件 |
| `packages/ui/src/components/hud/HudOverlay.tsx` | 使用启动阶段控制条幅与面板显现 | 需同步交接，保证空场景和低帧率下的 HUD 可用 |

现行约束见 [架构文档 §10.1](../architecture.md#101-bootstrap-order) 和
[Canvas 文档 §4.1、§5.2](../canvas-rendering.md)。实现时同步更新相关说明。

### 2. 画面与文案

启动层沿用 `#02030a` 背景、青色菱形标志和现有字体层级。中央为适度大小的
标志、`CKNERV` 和现有介绍语 `A visible body for CKB.`，下方只保留一处主状态
与下载读数。旧顶部启动条的信息合并到这处状态，避免同时出现两份加载提示。

环境光保持低亮度，呼吸周期初定 4 秒，只动画化透明度和轻微缩放；使用固定
渐变与少量 SVG/CSS 元素。装饰不生成 Cell、节点、拓扑连线或模拟链上脉冲。
主状态区域预留高度，阶段、数字和错误文案变化时不推动主体位置。

界面保持现有英文语言，以下为初版文案：

| 可观察状态 | 主文案 | 辅助信息 |
|---|---|---|
| HTML 已到达，主模块未开始执行 | `PREPARING CKNERV` | 简短介绍语 |
| 任一必需快照仍在请求或下载 | `RECEIVING CHAIN DATA` | 当前 Cells 请求的下载量；必要时说明仍在等待链快照 |
| 数据已就绪，等待正式场景呈现 | `PREPARING THE VIEW` | 可展开的阶段详情 |
| 必需请求一段时间没有新响应 | `STILL WAITING FOR DATA` | 保留已收到的数据量 |
| 加载确认失败 | `UNABLE TO LOAD CKNERV` | 简短原因、详细信息、`RELOAD` |

`INSTRUMENT / DECODE / GL / FABRIC` 等诊断名称保留在可展开的详情中。
这里的百分比仅表示当前数据下载，不能标为整个页面启动完成度。

### 3. 启动层生命周期与交接

1. 将静态启动层移为 `#root` 的兄弟节点，由页面启动控制器统一管理。
   React 创建和替换 `#root` 内容不会删除它。启动层本身的样式与最小脚本内联。
2. 正式 App 继续接收完整初始快照，在启动层后正常挂载、测量 HUD 和渲染。
   保持现有 Canvas 实例与相机拟合路径；底层不用 `display:none`，以免阻断布局
   测量或渲染。遮挡期间将 App 根节点设为 inert，避免键盘操作隐藏控件。
3. 新增单次的“正式视图已呈现”信号，表达：两份快照已成功、正式 HUD 已提交、
   当前 Canvas 的主场景已经实际完成绘制。信号在主场景绘制后报告，不能由
   `onCreated` 或绘制前的 `useFrame` 回调直接冒充。
4. 有可展示 Cell 时，交接信号需对应包含实际 Cell 内容的场景；合法的空快照
   则交接给已绘制的空场景与 DOM 空状态。分别显示“正在等待服务端填充”和
   “当前没有可展示的 Cell”，依据现有 backfill 与舞台成员状态判断。
5. 遮罩的退出使用该呈现信号，不要求达到某个 FPS，也不等待 `fabric`、
   `data_plane`、`seeding` 或可选 ckbadger 全部完成。现有 `first_light` 保留其
   流畅性诊断含义；HUD 中依赖它的启动显现门槛改用适合交接的呈现状态。
6. 信号到达即开始淡出，默认 400ms；无强制最短播放时长。启用
   `prefers-reduced-motion` 时取消呼吸并直接交接。退出后移除启动层，恢复
   App 交互，释放订阅、事件监听和计时器。
7. `transitionend` 和有界的清理计时器共用幂等销毁函数，覆盖后台标签页与动画
   被取消的情况。进入 App 后的断线与重同步继续由现有 HUD 处理。

独立呈现信号也用于现有 Visual Review Lab 路由的交接，避免只有生产 App
能移除遮罩。信号需绑定当前 Canvas；其它画布绘制不能触发它。

### 4. 下载进度、慢加载与失败

**进度的唯一来源。** 在现有浏览器 boot 记录中补足必需请求的最小观测，涵盖
chain 与 Cells 的请求开始、响应、读取、完成和失败。Cells 每次尝试分别记录
字节数与有效总量，二进制回退 JSON 时开启新的 attempt，并显示重新读取。
进度展示与等待判断消费同一来源；调整现有高水位展示契约及其测试，不保留
另一套并行计数。原有阶段终态无需倒退，当前请求仍可独立报告真实传输活动。

有可信、同口径的总长度时显示百分比与已收/总量；缺少长度、长度异常或响应
编码使长度口径不一致时显示已接收量。一次下载达到 100% 后，若另一个必需
请求未完成，继续明确报告等待该请求。回退下载不能沿用前一次的 100%。

**等待阈值。** 初定某个未完成的必需网络请求连续 8 秒没有新响应或字节时
显示等待提示，30 秒时提供 `RELOAD`。阈值均表示观测到的等待，不宣判网络
失败。任何有效读取均刷新该请求的活动时刻；已经完成的请求不参与检测。
下载持续有进展时，即使总时长超过 30 秒也保持下载读数。时间决策使用可注入
的单调时钟，测试覆盖阈值、恢复和后台标签页返回。

主模块尚未执行时由静态层计时，30 秒后提供重新加载；主模块接管后结束这段
计时，转入请求观测。解码和渲染等待使用各自状态，不标成网络停滞。首帧长时间
未出现时保留“准备画面”及重新加载入口，不按计时器伪造呈现成功。

**失败出口。** 处理主模块加载错误、两种快照路径最终失败，以及 React 初次
渲染或 WebGL 初始化失败。启动期间错误进入同一静态错误区域，停止装饰动画，
详细原因安全写为文本。React 渲染错误需要错误边界；`bootstrap().catch`
本身不能覆盖 React 异步提交错误。脚本完全禁用时提供静态 `noscript` 说明。

初版 `RELOAD` 重新加载当前 URL，保留查询参数并让新页面重新初始化所有
启动状态；不增加部分重启 boot store 的流程。等待提示不自动中止或重发仍在
接收的数据。用户进入 App 后不重新弹出全屏启动层。

### 5. 实施顺序与文件范围

| 步骤 | 实施内容 | 主要文件 | 完成条件 |
|---|---|---|---|
| 1 | 添加纯展示决策与请求观测，明确 attempt、等待和失败语义 | `packages/ui/src/boot/bootSequence.ts`、`ui-app/src/connect.ts`；建议新增 `ui-app/src/boot-presentation.ts` | 数据就绪、回退、单请求停滞均可由输入事件确定，测试通过 |
| 2 | 制作静态启动画面，独立保留 DOM，实现早期等待与错误入口 | `ui-app/index.html`、`ui-app/src/boot-shell.ts`、`ui-app/vite-boot-faces.ts` | 延迟主 JS 时仍有完整画面与重新加载入口，沿用现有字体预加载 |
| 3 | 接入正式视图呈现信号、淡出、空状态和初始化错误边界 | `ui-app/src/main.tsx`、`ui-app/src/App.tsx`、`packages/ui/src/boot/`、现有 Lab 入口 | React 挂载不会清空启动画面；首帧、低 FPS、空快照均可正确交接 |
| 4 | 同步 HUD 显现与状态条交接，完成无障碍和清理 | `packages/ui/src/components/hud/HudOverlay.tsx`、`BootSequenceBanner.tsx`、`bootSequencePresentation.ts`、`ui-app/src/boot-shell.ts` | 一个状态出口，面板可用，相机稳定，退出后无覆盖层或监听残留 |
| 5 | 浏览器验收、嵌入式 CLI 冒烟、同步架构说明 | `ui-app/VISUAL_REVIEW.md`、`docs/architecture.md`、`docs/canvas-rendering.md` | 验收矩阵通过，文档描述最终实现 |

新增文件名称可随现有模块组织调整；状态决策和 DOM 副作用分开，测试直接验证
用户可观察行为。对“启动壳必须在 `#root` 内”的旧测试要随新生命周期改写。

### 6. 验证与验收

**自动化回归。** 扩展 `ui-app/__tests__/boot-shell.test.ts`、
`connect.snapshotStream.test.ts`、`App.sceneRoots.test.tsx`、
`App.hudOverlay.test.tsx`，以及 `packages/ui/__tests__/bootSequence.test.ts`、
`firstLightDetector.test.ts` 和现有启动条组件测试。新增展示决策与真实呈现信号
的必要测试，至少覆盖：

- 静态 HTML 自带主体；React 挂载后保留，收到实际呈现信号后只清理一次。
- 已知/未知长度、持续慢速读取、请求停滞后恢复、chain 单独延迟，以及二进制
  部分读取失败或解码失败后的 JSON 回退读数。
- 只有 GL 上下文或绘制前回调时保持启动层；低 FPS 和空 Cell 数据有合法出口。
- 整体 boot 未完成时允许呈现交接；正式使用中的重连不会重建遮罩。
- 初始化失败、重新加载保留 URL、StrictMode 重复执行、淡出中事件重复、
  reduced-motion、定时器和订阅释放。

绘制顺序、合成效果和相机稳定性由真实浏览器验证，jsdom 用于状态与 DOM 行为。

**浏览器矩阵。** 同一份捕获的真实快照用于前后对照；延迟、分块和错误通过
本地测试代理或浏览器请求拦截注入，不写入生产服务的数据路径。

| 场景 | 通过标准 |
|---|---|
| 禁用缓存，延迟主 JS 10 秒 | HTML 首次可绘制时已有主体，动画与正文不依赖主 bundle |
| 主 JS 加载失败或一直未到达 | 错误或长等待入口仍可用；无纯空白屏 |
| 快照限速至 256 KiB/s、延迟 300ms | 下载读数持续变化；不会仅因等待总时长长而报错或自动重试 |
| chain 延迟 15 秒，Cells 已完成 | 显示仍在等待 chain，不停留在总体“100%” |
| 必需请求无活动超过 8 秒/30 秒 | 分别出现等待提示与重新加载；恢复读取后撤回等待提示 |
| 缺少长度、二进制回退 JSON | 读数口径正确，回退尝试可辨识，最终交接一次 |
| 两路失败、WebGL 不可用、React 初次渲染失败 | 同一错误区域说明原因，键盘可操作重新加载 |
| 合法空快照，分别有/无 backfill | 进入真实空状态与可用 HUD；后续 Cell 正常进入 |
| 低于 25 FPS，或后台打开后切回 | 实际画面可呈现后退出遮罩，不等待连续流畅帧 |
| 热缓存快速打开、reduced-motion | 无人为最短等待；减少动态效果时直接交接 |
| 宽度 1440、768、390、320px，及窄屏横向 | 文案、错误和按钮无重叠或裁切；字体到达不推动主体 |
| 交接前后、调整尺寸、手动 orbit | 无背景闪白和相机跳位；现有用户相机所有权保持有效 |
| 现有 Visual Review Lab 路由 | 遮罩退出；原有 ready 标记、固定时刻与截图流程有效 |
| 交接后断网与重连 | 使用现有 stream-health HUD，无遮挡层重新出现 |

记录 HTML 首次可见、必需快照就绪、真实视图首次呈现及启动层移除四个时刻，
并截取静态加载、慢速下载、交接和失败状态。时间记录只用于本地验收；不新增
外部遥测。启动画面不新增网络请求，比较同条件下首帧耗时，排查新增明显长任务。

实现完成后执行仓库构建门禁：

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
pnpm test
pnpm typecheck
cargo build --release -p cknerv-cli
git diff --check
```

SPA boot path 改动还需按 [CLI smoke checklist](../../crates/cknerv-cli/SMOKE.md)
使用独立临时 workdir 和可用端口启动新 release binary，验证 chain/cells
snapshot 形状、节点推进时 tip 跟随，以及 Ctrl-C 保存状态并释放端口。
不能只验证 Vite；嵌入式页面也要完成至少一次慢加载和交接检查。

本次实施已执行上述自动化与构建门禁，并使用新 release binary 和隔离 workdir
完成嵌入式页面验收；具体运行证据记录在任务交付报告中。

### 7. 执行记录

- 仓库门禁：全量 `pnpm test`、`pnpm typecheck`、Rust format、clippy、test
  及 release build 均通过。
- 新 release binary 的嵌入式页面在真实快照上验证了正常启动、10 秒 bundle
  延迟、持续慢速 Cells、停滞后恢复、chain 单独延迟、未知长度、binary 到 JSON
  回退、请求失败、WebGL 失败、低帧率及合法空快照。
- 生产入口、四个有数据 Lab 和四个 DOM-only 空 Lab 均完成一次交接；退出后
  `#root` 恢复交互，早期启动全局与监听清理。320、390、768、1440 px 及窄屏
  横向布局通过，展开详情和出现 `RELOAD` 时主体位置保持稳定。
- 隔离运行中 chain tip 与 revision 前进，快照路由形状符合现有契约；关停后
  状态持久化并释放端口。无需 purge。
