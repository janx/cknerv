# 启动快照压缩与入口拆包计划

日期：2026-09-19。状态：已实施并完成验收。
基线：`ddca14de`，workspace 1.1.0。
关联：[GitHub issue #1](https://github.com/janx/cknerv/issues/1)。

本计划承接[启动加载体验计划](2026-09-09-startup-experience.md)，优化启动
关键路径。现行契约仍以 [architecture.md](../architecture.md)、
[api.md](../api.md) 和 [canvas-rendering.md](../canvas-rendering.md) 为准。
第 1 节保留实施前的隔离构建实验；它不代替第 9 节的最终产物与浏览器测量。

## Goal

- 减少 Cells 二进制快照的实际传输量，让浏览器更早开始两份 bootstrap 请求。
- 将 App、ReactDOM 和诊断模块的加载与快照 I/O 重叠，缩小请求发起前必须
  下载和执行的 JavaScript。
- 保证快照内容、响应头与恢复游标属于同一个 revision；压缩不会阻塞 reducer
  或让过期任务覆盖当前缓存。
- 保留静态启动层、真实进度、明确的失败出口，以及首个真实画面的交接条件。

## Principle Alignment

- **CKB Native**：压缩前后的 columnar 数据逐字节一致，快照成员、Cell 身份、
  统计、历史与实时事件语义不变，不通过减少展示数据换取启动速度。
- **Local First**：压缩能力由 CLI 内的 server 提供，浏览器使用原生 HTTP
  解压；本地直连与 hosted 模式都可受益，无新增外部服务或节点写操作。
- **Agent Friendly**：定义协商矩阵、并发时序、构建依赖检查与可重复的验收输入，
  区分产物体积、线上传输量和真实视图呈现耗时。
- 压缩、缓存与 HTTP 协商留在 `cknerv-server`；启动接线留在 `ui-app`，窄入口
  由 `packages/ui` 提供。`cknerv-core` 不引入压缩或异步运行时依赖。

## Result

- 已交付快照原子性修正、按 revision 复用的 gzip 表示、HTTP 协商、轻量
  bootstrap、异步模块等待与失败状态、自动检查和浏览器/CLI 验收记录。
- State/purge required：**no**。本轮不修改持久化 schema、columnar 格式、
  Rust/TS wire 类型或配置形状。
- 下一步：审查变更并决定是否关闭 issue。

### 1. 基线、证据与范围

issue 报告生产样本的原始快照为 6,234,466 B，gzip 后为 2,663,341 B，约减少
57%；还报告了约 3 ms 的首页 origin TTFB。这些是计划阶段的外部基线；第 9 节
另列本次固定快照、压缩负载与真实浏览器时序，二者不可混用。

实施前使用 `ddca14de` 和 Vite 5.4.21，在内存中替换启动 imports 后分别构建，
输出到独立临时目录。统计最终落盘的入口文件，以标准 gzip 默认等级计算大小；
检查入口的递归静态依赖，动态 imports 不计入请求发起前的依赖总量。

| 方案 | 入口原始字节 | 入口 gzip 字节 | 入口静态依赖含 Three/R3F |
|---|---:|---:|---|
| `ddca14de` 当时实现 | 2,346,667 | 718,315 | 是 |
| 仅动态导入 App 与诊断 hooks | 2,235,059 | 683,619 | 是 |
| 再收窄启动模块的 UI imports | 183,801 | 59,865 | 否 |
| 再动态导入 ReactDOM | 49,720 | 17,339 | 否 |

完整 3D 应用仍需下载和执行。上述实验当时只验证拆分边界，未验证候选在浏览器
中的挂载、错误恢复或首帧耗时；当时 `connect.snapshotStream.test.ts` 与
`boot-shell.test.ts` 的 35 项结果也只属于未修改基线。最终实现与浏览器证据另见
第 9 节，正式构建检查不依赖本机 `/tmp` 文件。

代码审查确认的实施约束：

| 位置 | 当前行为 | 本轮处理 |
|---|---|---|
| `projection_registry.rs::apply` | 投影写锁释放后才更新 revision | 将状态与 revision 的发布纳入同一写入边界 |
| `SnapshotCache::put` / `remember` | 晚完成的旧序列化可以替换新缓存 | 锁内核验版本，拒绝过期发布 |
| `routes.rs::projection_snapshot_bin` | 直接返回原始二进制 | 协商 gzip/identity，共用同一快照来源 |
| `main.tsx` 及启动辅助模块 | App、ReactDOM、hooks 和 UI 总入口参与静态依赖 | 窄入口加并行动态加载 |
| `boot-presentation.ts` | 未设置 `viewPreparingAtMs` 时等待时间每次归零 | 覆盖快照已完成、模块仍在加载的等待窗口 |
| `connect.ts::parseContentLength` | 压缩响应已经禁用不可信的百分比分母 | 保留行为并修正文档注释 |
| `cknerv-cli/src/assets.rs` | 静态资源直接返回原始文件 | 测量时核对真实 Content-Encoding，区分直连与代理 |

前两项并发窗口来自静态代码分析；S1 先补确定性交错测试。范围限定在同一
快照/缓存路径，不借此重构全部 reducer、ring 或 enrichment 调度。
静态 JS/CSS 预压缩、Brotli、CDN 缓存、分页快照、浏览器持久化和 WebSocket
压缩留作后续独立工作。

### 2. 阶段与退出条件

| 阶段 | 交付 | 退出条件 |
|---|---|---|
| S0：固定基准 | 最终构建依赖检查、固定快照、浏览器记录方法 | 基线可重跑，测量口径和输入有记录 |
| S1：快照一致性 | revision 原子发布、过期缓存写回防护 | 确定性并发测试通过，原有快照与 quarantine 行为无回归 |
| S2：快照压缩 | 按需 gzip、共享在途结果、协商响应 | 协商矩阵、字节等价、去重与限流测试通过 |
| S3：启动拆分 | 窄 imports、并行模块加载、等待/失败状态 | 初始静态 JS 预算达标，首次 ingest 与启动交接测试通过 |
| S4：联合验收 | 浏览器配对、全量门禁、release smoke、文档同步 | 实际启动收益和恢复正确性均有证据 |

### 3. S0：固定基准与最小检查入口

主要范围：`scripts/`、`ui-app/vite.config.ts` 的必要构建观测、现有测试 fixtures
和本计划的验收记录。小型脚本和输入说明可入库；真实快照、trace、截图、完整
构建产物及工作目录保持本地。

1. 增加可从干净 checkout 运行的构建检查入口。通过 manifest 和 Rollup 模块图
   找到真正入口，遍历全部静态 imports 并去重；读取最终落盘文件统计 raw 与
   gzip 字节。不能只检查名为 `index-*.js` 的一个文件，也不能靠调整 chunk
   名称或 warning 阈值通过验收。
2. 输出 commit、Node/pnpm/Vite 版本、压缩口径、入口依赖列表及其中的 Three、
   R3F、drei、leva、ReactDOM 模块。普通浏览器和构建测试不依赖手写 hash 文件名。
3. 正确性测试复用 `tests/fixtures/` 的 columnar v6 配对输入。性能测试另外固定
   一个有代表性的真实舞台快照，记录 SHA-256、revision、格式版本、Cell/
   resident/link 数、原始长度和来源。冻结测试服务的 mutation 输入后比较
   identity 与 gzip，避免两次 live 请求跨 revision 导致无意义的哈希差异。
4. 建立基线和候选的独立 production 服务、端口及工作目录。浏览器记录页面导航、
   入口开始执行、两份快照请求/响应/完成、应用模块就绪、解码结束、React 挂载
   和 `viewPresented`；继续以实际 post-render 信号衡量真实画面出现。

工程目标如下；S4 必须报告实测值，不能用构建字节数替代耗时：

| 项目 | 目标/判定 |
|---|---|
| 启动入口及其全部静态 JS | gzip 总量 ≤ 25,000 B；无 Three/R3F/drei/leva/ReactDOM 实现 |
| 请求发起顺序 | 任一重模块尚未解析完成时，chain 与 Cells 请求已发起 |
| 代表性真实快照 | gzip/raw 目标 ≤ 0.50；同时报告首次压缩 CPU 和 TTFB |
| 热 gzip 请求 | 复用 Bytes，不再次压缩，不取得投影锁，不创建 blocking 任务 |
| 并发压缩 | 同一代快照共享构建；全服务同时运行的压缩任务有固定上限 |
| 用户等待 | 模块延迟/失败可见，启动层不会空白或永久失去 RELOAD 入口 |
| 最终启动收益 | 受限网络下真实视图呈现 p50/p95 改善；本地直连无可重复的启动回归 |

### 4. S1：快照与 revision 一致性

主要范围：`crates/cknerv-server/src/projection_registry.rs` 及其现有单元测试。

1. 投影状态修改成功后，在释放同一个投影写锁之前提交 revision 并使当前缓存
   失效。保留现有 delta/ring/broadcast 顺序和服务端外层协调边界；不要为压缩
   扩大这些锁的持有时间。
2. 读取快照与其 revision 继续共用投影读锁。JSON 序列化、gzip 压缩及任何
   `await` 都不持有投影锁或快照缓存锁。本轮不重写现有 columnar 编码器。
3. 缓存发布在缓存锁内核验捕获 revision 与当前 revision。旧工作即使完成，也
   不能替换较新的 bare/frame/bin/gzip。核验与写回必须共用同步边界，不能先
   比较再单独加锁写入。
4. 允许一个已经捕获 revision R 的请求完整返回 R，由 WS 从 R 恢复。不要因
   压缩期间出现 R+1 就无限重取、重压缩。响应头也必须来自 R，不能压缩结束后
   再读取 runner 的最新 revision。
5. 保持缓存命中的轻量路径，以及已隔离投影对最后成功缓存的读取行为。
   失败的 apply 不发布新 revision，也不把半应用状态变成新的压缩缓存。

以 barrier/channel 控制交错，避免靠短 sleep 或高频竞争碰运气：

- 状态写入与 revision 提交之间发起读取，返回内容与 revision 始终匹配。
- R 的序列化暂停；R+1 应用、取快照并缓存；释放 R 后，新缓存仍为 R+1。
- 序列化暂停期间 mutation 可以完成；既有“序列化不持有投影锁”测试继续通过。
- 已缓存的最后成功状态在投影 apply panic/quarantine 后仍可读取；健康检查和
  其它投影继续工作，失败状态不进入持久化。

### 5. S2：按 revision 复用 gzip 表示

主要范围：`projection_registry.rs`、`routes.rs`、server 的压缩依赖与测试。
压缩库使用快速等级，例如 `flate2::Compression::fast()`；依赖不进入 core。

#### 5.1 缓存和任务生命周期

- 将 revision、已经补好 revision header 的原始 `Bytes`、惰性 gzip 结果视为
  同一代快照。可由一个共享句柄承载；不要维护独立、可能错位的 raw/gzip 版本。
- 只有接受 gzip 的 HTTP 请求触发压缩。revision 前进时移除当前缓存引用，
  不在每次 mutation 后预压缩，也不建立长期保留旧 revision 的缓存表。
- 并发请求共享同一代的在途构建及结果。原始快照的并发建造者发布时重新检查
  缓存，收敛到同一共享表示，避免各自对同 revision 再压缩一份。
- 首次压缩在 `spawn_blocking` 中执行。采用全服务固定上限的许可，初始值为
  **2**，不增加配置项；压缩线程完成前持有许可。限制作用于真正执行的任务，
  不能在请求 future 取消后提前释放仍在计算的任务所占许可。
- 首个请求断开不应丢失共享构建所有权或让其他等待者永远收不到结果。旧代任务
  可以完成并服务已有等待者；完成结果不重新挂回当前缓存。没有等待者且完成后，
  旧代内存应可释放。
- 压缩失败必须释放任务状态、唤醒等待者并返回明确的服务端错误，日志保留原因。
  不得附着 gzip header 返回原始字节。浏览器仍可使用既有 JSON fallback。
  故障测试应证明没有卡住的 pending 状态或无限内部重试。
- `snapshot_bin()` 对 WS 的原始二进制契约保持不变。HTTP 表示选择不能让
  `/stream?bin=1` 意外收到 gzip 数据。

#### 5.2 HTTP 协商

只调整 `GET /api/projections/:name/snapshot.bin` 的表示选择。遵循
[RFC 9110 §12.5.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.3)：
完整识别编码 token、quality、通配符与 identity；处理多行 header 和大小写，
不用子串匹配或 `q` 字符串前缀判断。

| Accept-Encoding / 路由 | 预期 |
|---|---|
| 缺失或空值 | 原始响应，保留现有客户端默认行为 |
| `gzip`；`br, gzip, deflate`；`GZip` | gzip |
| `gzip;q=0.5` | gzip 可接受 |
| `gzip;q=0`；`gzip;q=0.00`；`gzip;q=0.000` | 原始响应 |
| `*;q=1` | gzip 可接受 |
| `gzip;q=0, *;q=1` | gzip 被显式排除，返回原始响应 |
| `identity;q=1, gzip;q=0.5` | 尊重显式偏好，返回原始响应 |
| `identity;q=0, gzip;q=1` | gzip |
| `identity;q=0, gzip;q=0`；`*;q=0` | 406，无可接受表示 |
| 未知或没有 columnar 表示的投影 | 保留 404 及客户端回退路径 |

非法 q 值不能默认为允许 gzip。重复编码和畸形参数使用明确、可测试的保守
策略，并记录策略；显式排除不能被通配符覆盖。

两种成功表示都带 `Vary: Accept-Encoding`，保留已有其它 Vary 值。
`Content-Type` 仍为 `application/octet-stream`，`X-Snapshot-Revision` 与
解压后的二进制 revision 一致。只有 gzip 响应有 `Content-Encoding: gzip`；
若发送 `Content-Length`，值必须是实际发送表示的长度。
JSON 路由、访问策略、静态资源路由和持久化文件均不改变。

#### 5.3 正确性和负载检查

- 固定 revision 下，gzip 解压结果与 raw 逐字节相同；同时核对二进制头及
  HTTP revision header。复用 Rust/TS columnar parity fixtures，无需改格式。
- 通过计数器证明按需生成、同代并发去重、热命中零压缩、revision 变化后失效。
- 暂停旧代压缩并推进 revision，新代可继续应用；旧结果不会污染新缓存。
- 覆盖请求断开、任务失败、许可上限、等待者唤醒与旧代结果释放。
- 对独立测试服务执行 1/8/32 并发请求，分别记录冷 miss/热 hit 的 TTFB、总耗时、
  压缩次数、CPU 和峰值内存，同时观察 `/api/health` 与 mutation 推进。
- 扩展 `server_smoke.rs`、`hosted.rs` 或独立压缩路由测试。校验线上编码字节的
  HTTP 测试必须关闭客户端自动解压；浏览器集成测试则验证原生解压后的 decoder。

### 6. S3：轻量入口与完整启动生命周期

主要范围：`packages/ui/package.json`、`ui-app/src/main.tsx`、`connect.ts`、
`boot-shell.ts`、`boot-presentation.ts`、诊断 hook 接线以及 boot store/测试。

#### 6.1 依赖边界与并行启动

1. 增加 `@cknerv/ui/boot`、`@cknerv/ui/quality`、`@cknerv/ui/stream-health`
   三个窄导出，直接指向已有模块。仅当真实运行时调用需要时再增加
   `boot-presentation` 子入口；类型引用本身不要求额外运行时入口。
2. 检查整个启动静态依赖闭包，替换 `main.tsx`、`connect.ts`、`boot-shell.ts`
   中的 UI 总入口 imports。原 barrel 与新入口重用同一模块，不复制 boot/
   quality store；保留 Vite 的 React/Three singleton dedupe。
3. 安装静态启动层订阅、记录入口开始时间并决定初始 quality，然后立即发起两份
   快照请求。并行动态加载所选 App 或 Review Lab、`react-dom/client` 和诊断
   模块；不要先等待模块完成，再开始取快照。
4. 两份数据、所选视图、ReactDOM 和挂载前必需的 hook 都就绪后，才创建 root
   并 render。普通入口不额外加载全部 Lab；Lab 不要求加载生产 App。
5. `installCellFieldHook()` 必须在首次 `ingestCellsCacheIntoField()` 前完成，
   正确保留 `?dev=1` 与普通页面的行为。Pulse 诊断 hook 独立于快照成功与否
   安装：模块可用时，即使数据请求失败仍可观察诊断信息。
6. 沿用静态壳和 React 错误边界。动态 import 拒绝必须进入静态错误区域，且
   所有并行 promise 都有错误归属，不能制造未处理 rejection。

#### 6.2 模块等待和错误归因

- 在既有 boot record 中补充最小的必需模块加载状态：开始、就绪、失败及单调
  时钟。与快照 request 状态分开，避免把 chunk 失败写成 snapshot 或 GL 失败。
  React/HUD 与静态壳消费同一记录，不另建第二套启动状态机。
- 当快照已完成而模块未就绪时，持续显示准备画面。模块等待达到 30 秒时提供
  手动 `RELOAD`，不能使用每次刷新都重置的起点；模块完成后转入既有首帧等待。
- 模块与数据可以以任意顺序完成。快照的 8 秒无活动提示和 30 秒手动重载规则
  保持基于各自请求；模块等待不能重置这些请求的活动时间。
- 不根据计时器伪造完成，不自动重载或重复发起仍在进行的请求。静态层仍只在
  当前视图实际呈现后退出，保留空场景、reduced motion、inert 与幂等清理行为。
- 浏览器原生解压后，reader 收到的是 decoded bytes，而 Content-Length 可能
  是 encoded bytes。保留 `parseContentLength` 的不确定进度策略，并修正
  `connect.ts` 中“快照没有 content-encoding”的过时注释。

#### 6.3 自动回归

新增或扩展相关 `__tests__/` 中的行为测试：

- 挂起 App/ReactDOM imports 时，两份 snapshot fetch 已经开始，React 尚未挂载。
- imports 先完成、快照先完成和二进制回退 JSON 三种顺序都可成功进入视图。
- App/ReactDOM/hook chunk 拒绝时静态错误 UI 和手动重载可用；等待超过 30 秒
  后允许用户重载，后续模块成功仍能正常交接。
- `?dev=1` 首次缓存完整进入 CellField；普通页面保持未启用；StrictMode 不造成
  重复 root、hook 副作用或监听器泄漏。
- 显式 quality override、AUTO 初始值、四种 Review Lab 和合法空快照不回归。
- 压缩响应没有错误百分比，失败后 JSON fallback 的 attempt/进度正确。
- 新旧导出访问同一 boot/quality store；生产构建满足 S0 的递归静态依赖预算。

重点复用 `connect.snapshotStream.test.ts`、`boot-shell.test.ts`、
`cell-field-hook.test.ts`、`render-quality.test.ts`、
`packages/ui/__tests__/bootSequence.test.ts` 及现有 boot presentation 测试。

### 7. S4：联合验收与文档同步

#### 7.1 浏览器与性能

使用同一浏览器版本、机器、视口、DPR、quality 和固定数据输入，交替运行基线/
候选，每组至少 20 次冷加载；热缓存刷新单独记录。记录浏览器网络缓存开关、
CPU 限速、后台负载和实际 GPU 路径，不混合不同条件的 p50/p95。

至少覆盖：本地直连、hosted 同机反向代理、10 Mbps/60 ms RTT 受限网络，及
受限网络加 4× CPU slowdown。每种条件记录：

- 入口及静态依赖的实际响应编码/传输字节，快照 encoded/decoded 字节。
- 两份 API 请求开始时间、响应等待、下载、decode、模块就绪、React 挂载、
  `viewPresented` 时间，启动 long tasks，以及快照回退/重复同步次数。
- 冷 gzip miss 与热 hit 的服务端延迟、CPU 和内存；不能只测已经压好的热缓存。

`serve_spa` 当前直接返回原始 JS，因此必须分别报告原始产物、gzip 对照体积和
真实网络传输量。检查代理没有对已有 gzip 响应重复编码，正常协商仍生效。

功能矩阵覆盖：普通页面、`?dev=1`、quality override、四种 Lab、空场景、
reduced motion；延迟/拒绝 App chunk、单个快照失败、binary 404/格式错误回退、
两种 Cells 请求都失败、后台返回及重载。
静态壳需持续可见，首个真实画面交接后无覆盖层或监听残留。

特别验证“快照先完成、App 很慢且链继续前进”：挂载后必须从快照自身 revision
接流；ring 覆盖不足时正常全量同步。记录额外快照成本，不能为了降低重复流量
跳过增量或伪造新的起始游标。

#### 7.2 工程门禁与 release smoke

先运行阶段相关测试，最终完成仓库全门禁：

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
pnpm test
pnpm typecheck
cargo build --release -p cknerv-cli
git diff --check
```

release 构建不设置 `CKNERV_SKIP_UI_BUILD`。使用独立工作目录和空闲端口，按
[CLI SMOKE.md](../../crates/cknerv-cli/SMOKE.md) 检查嵌入的实际候选 SPA：

1. chain 与 Cells JSON snapshot 形状正确；binary 的 raw/gzip、header、解压
   内容与 revision 正确，未知/非 columnar 投影保留原行为。
2. chain、cells、semantics 三条 WS 路由断开后重连；额外验证 cells `bin=1`
   全量恢复仍是原始 columnar 数据，以及 ring 内增量恢复。
3. 通过隔离实例生成有效 checkpoint，停机期间让节点继续出块，候选从该文件
   恢复到 live tip；没有非预期全量 hydration 或把 replay 播放成实时事件。
4. Ctrl-C 与 SIGTERM 保存状态、释放端口；正常刷新与重启不需要 purge。
   不对用户现有 workdir 做清理或迁移。

#### 7.3 文档与完成记录

实现完成后同步：

- `docs/api.md`：binary 协商、响应头、406、404 与 JSON fallback。
- `docs/architecture.md`：原子边界、缓存生命周期和新的 bootstrap 并行顺序。
- `docs/canvas-rendering.md`：模块等待、压缩进度、错误出口和真实呈现交接。
- `docs/development.md`：构建检查/测量入口及本地/hosted 传输口径。
- `crates/cknerv-cli/SMOKE.md`：gzip 与慢模块接流的验收步骤。

只有 S4 完成后，将本计划状态改为“已实施”，补充最终 commit、实测值、环境、
测试结果和未覆盖项。收益不足时保留原始记录并定位阶段成本，不把“入口变小”
写成“首屏更快”。

### 8. 完成清单

- [x] S0：可重跑的构建依赖检查、固定快照与启动基线。
- [x] S1：快照/revision 原子一致，旧结果不能覆盖当前缓存。
- [x] S2：gzip 协商、同代复用、限并发、取消/失败处理及字节等价测试。
- [x] S3：窄入口、ReactDOM/App 并行加载、hook 顺序与启动等待/失败测试。
- [x] S4：受限网络实际启动收益、本地回归检查、全门禁及 release smoke。
- [x] API/架构/Canvas/开发/冒烟文档描述最终实现，记录 State/purge required：no。

### 9. 实施验收记录

实现基于 `ddca14de1a76c9484fc701f2241f20ec0c845462`；验收在提交前的完整
候选工作树执行。正式候选使用 Node v24.14.0、pnpm 9.0.0、Vite 5.4.21 和
release CLI 构建，未设置 `CKNERV_SKIP_UI_BUILD`。

固定性能输入来自本机 `localhost:8114` 的只读 CKB 节点，在默认 50,000 live
Cell hydration 完成并写入 checkpoint 后复制到隔离工作目录。采样服务再以不可达
RPC 恢复该 checkpoint，使 mutation 输入在配对期间冻结；原始快照不入库。

| 固定输入 | 值 |
|---|---:|
| snapshot revision / columnar version | 170,423 / v6 |
| Cell / resident / member / recent-link 数 | 11,488 / 0 / 11,488 / 2,048 |
| raw / gzip-fast 字节 | 4,824,830 / 1,924,523 |
| gzip/raw | 0.3989 |
| 解压后 SHA-256 | `612e9c7818ae445c95815442fc41458d3e9f54e4405ea37865434110fdd8f7eb` |

构建检查从 manifest 与 Rollup graph 得到下列真实入口闭包；基线入口也在独立
`ddca14de` worktree 重新构建，并与固定基线文件逐字节 SHA-256 相同。

| production SPA | 静态启动 JS raw | 标准 gzip 对照 | 重模块违规 |
|---|---:|---:|---|
| `ddca14de` 基线 | 2,346,667 B | 718,315 B | Three/R3F/ReactDOM 在入口 |
| 候选 | 51,496 B | 17,869 B | 无 |

独立协议验收在 live-node 候选上执行了 30 个 HTTP case：协商矩阵、真实编码字节、
解压逐字节等价、binary/header revision、unknown/non-columnar 404、406 与并发请求
均通过；`.vite/bootstrap-static-graph.json` 从嵌入服务返回 404。对应 live 快照
revision 171,265 为 4,823,470 B raw、1,923,961 B gzip，比例 0.3989。

独立 headless Chromium 功能验收使用 1180×760、DPR 1、low quality 与
SwiftShader，执行 18 份报告且没有 runtime exception：普通与 dev 首次 ingest、
两份请求先于 App、App/ReactDOM/CellField 延迟或拒绝、binary 404/坏格式 JSON
回退、chain/Cells 最终失败仍安装 Pulse 诊断、AUTO、reduced motion 及四种 Lab
均通过。App 延迟超过 30 秒时壳保持可见并给出 `RELOAD`，放行或点击重载后可
恢复；dev 首次同步的 11,488 行与快照逐行一致。

冷启动采样使用 Chrome 153.0.8010.36、1180×760、DPR 1、low quality、禁用
浏览器缓存的独立 context，在每种条件下交替执行 20 轮基线/候选。采样机为
Linux 7.2.6、AMD Ryzen AI 9 HX 370（24 个逻辑 CPU）、约 100 GB 内存；渲染路径
是 ANGLE/Vulkan SwiftShader。采样 Node 为 v22.22.2；正式 SPA/release 构建使用
上文记录的 Node v24.14.0。采样开始时 1 分钟 load average 为 2.13，单个条件内
观测值曾到 16.46，因此这些数字适合比较同机交替样本，不代表无干扰 GPU 基准。

下表的 p50/p95 使用 nearest-rank；正数表示候选更慢，负数表示候选更快：

| 条件 | 基线 viewPresented p50/p95 | 候选 p50/p95 | 候选变化 p50/p95 |
|---|---:|---:|---:|
| 本地直连 | 1,265.2 / 2,367.8 ms | 1,339.5 / 2,237.6 ms | +74.3 / -130.2 ms |
| 同机 hosted proxy | 1,154.6 / 2,133.3 ms | 1,142.0 / 2,162.8 ms | -12.6 / +29.5 ms |
| 10 Mbps / 60 ms | 7,246.8 / 8,199.3 ms | 5,044.2 / 5,362.6 ms | -2,202.6 / -2,836.7 ms（30.4% / 34.6%） |
| 10 Mbps / 60 ms + 4× CPU | 9,077.2 / 10,065.8 ms | 6,204.4 / 7,160.6 ms | -2,872.8 / -2,905.2 ms（31.6% / 28.9%） |

本地 20 个配对轮次中候选快/慢各 10 次，配对差值的常规中位数为 +5.0 ms；
结果混合，未观察到一致方向。hosted proxy 的 p50/p95 也分处零点两侧。共享主机
负载限制了这两组小差值的解释。两个受限网络条件则在全部 20 个配对轮次中均由
候选更早呈现，且 p50/p95 都改善约 29%–35%。所有 160 个冷样本的 runtime
exception 数为 0。

本地直连的两份 API 总 encoded body 从 4,837,475 B 降到 1,937,168 B，decoded
总量均为 4,837,475 B；完整应用到呈现时加载的 JS 总量仍约 2.35–2.38 MB，说明
入口拆分移动了请求时序，并没有删除 3D 应用。hosted proxy 会压缩基线的原始
binary，因此该路径的 API encoded body 为基线 1,799,289 B、候选 1,929,829 B；
候选响应已经编码，代理没有再次编码。构建预算衡量的是发起 bootstrap 前的静态
闭包，不能与上述完整应用传输量互换。

固定 checkpoint 恢复后 delta ring 为空。App 使用合法的当前 snapshot cursor
连接 WS 时，既有 `decide_action` 会发送 FullSnapshot；本地/代理样本在 lit 前
观察到 0 或 1 个 4,824,830 B 原始 binary frame，受限网络样本在 lit 前为 0。
这个冻结输入的 resync 成本对两版相同，也不同于正常 live ring 启动，未计作候选
收益。冷样本的 `viewPresented`、请求发起顺序和 Resource Timing 字节可用；CDP
的 `responseReceived` dispatch timestamp 偶尔晚于 `loadingFinished`，所以不从
它推导 TTFB、等待和下载分段。独立 warm reload 记录使用浏览器 Resource Timing。

独立 cache-enabled warm smoke 在每个条件下先预热一次再 reload 一次。它只验证
热路径，不是 20 轮分布：本地为 795.6→811.4 ms（基线→候选），hosted proxy
为 817.9→562.8 ms，10 Mbps/60 ms 为 4,732.9→2,510.5 ms，再加 4× CPU 为
5,031.4→2,603.8 ms。完整 Resource Timing 保留在本地验收报告中。

固定 revision 的独立服务分别承受 1/8/32 并发 gzip 请求。冷请求 TTFB p50 为
76.77/56.07/61.28 ms，热命中为 1.67/3.54/5.60 ms；同批 `/api/health` 为
0.90–3.47 ms。`/proc` 进程 CPU 增量的 10 ms tick 读数为冷 80/60/90 ms、热
0/0/30 ms；它包含整批 HTTP 工作，不能解释成纯压缩 CPU。冷批 RSS 从
652,120/652,784/652,952 KiB 到峰值 676,772/676,436/676,596 KiB，增加约
24,652/23,652/23,644 KiB；约 637–661 MiB 的绝对值主要是恢复后的投影，不是
gzip 新增内存。三次服务均 SIGTERM exit 0 并释放端口。运行时没有公开压缩构建
计数；同代只构建一次、热命中零构建、许可上限、请求取消和旧代释放由可观测
计数的单元测试证明。

最终 runtime wrapper 的 warm、gzip、WS、后台恢复、live restore 与空场景六项
均 exit 0、无超时。固定服务的 chain/cells/semantics JSON WS 首次连接和重连
都得到正确 revision 的 snapshot；cells `bin=1` 两次均为原始 CKNB v6、
4,824,830 B、revision 170,423。真实双 tab 切换把页面置于后台 6 秒时 rAF
计数保持 26，切回前台后变为 29；页面恢复为 visible，仍有两个 Canvas、启动壳
已退出且没有 runtime exception。该结果替代了早先 CDP 强制 lifecycle 的无效
尝试。

live-node 隔离实例先从固定 checkpoint 的 tip 20,501,453 追到 20,509,476，再
观察到 20,509,477；chain/cells 的 live delta 及从原 cursor 重连的 ring replay
均通过，独立复核还确认 replay 包逐条包含原 revision 192,599 mutation 与
revision 192,602 delta。可视化服务停机期间，CKB 节点继续出块；同一 workdir
随后恢复到 20,509,478。两次启动都记录 skipped backfill，没有 Boot hydration。
SIGTERM 与 SIGINT 均 exit 0、写入约 40 MB state 并释放端口。另一个 tip 0 的空
workdir 页面正常呈现两个 Canvas、无异常；SIGTERM 写入 908 B state 并释放端口。

最终门禁全部通过：`cargo fmt --all -- --check`、严格 clippy、`cargo test --all`
（server 118 tests）、`pnpm test`、`pnpm typecheck`、`pnpm bootstrap:check`、不设
`CKNERV_SKIP_UI_BUILD` 的 release CLI 构建及 `git diff --check`。本轮没有
持久化 schema、columnar wire 或配置形状变化，**State/purge required：no**。

参考：[HTTP 内容协商](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.3)、
[Tokio blocking 任务与并发限制](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html)、
[Fetch 解压语义](https://fetch.spec.whatwg.org/#handle-content-codings)、
[Vite 5 异步 chunk 加载](https://v5.vite.dev/guide/features#async-chunk-loading-optimization)。
