# testlite 优化日志

## 2026-10-16 · Round 1 · 方向：单点深度特化（门禁真实性）

### 决策原因

testlite 属于 family 的「零依赖单文件体检 CLI」。同赛道（jest --coverage / c8 / istanbul）都要装依赖，
且只管覆盖率，不管测试密度 / 零测试 / 超大测试文件；leasot 只扫 TODO。
「零依赖 + 测试卫生 + 内置 CI 门禁」这一格在 npm 上没有同级竞品，**保留**。

本轮不改功能方向，只做一件事：把它从「看起来能门禁」变成「门禁是真的」。
理由：这个工具唯一的价值就是退出码。退出码错一次，用户 CI 里的假绿灯就多一次。

### 具体改动（按优先级）

| 级别 | 缺陷 | 实测证据 |
|---|---|---|
| P0 | 扫描基线为空仍报通过 | 空目录 / 纯 Python 项目 → 健康分 10/100、警告「无」、门禁通过、rc=0 |
| P0 | root 路径含 `test/` 时源码全被误判为测试 | `.../test/myapp` 项目 → 测试 2 / 源码 0，密度恒 0，rc=0 |
| P0 | 未知选项静默通过 | `--bogus` / `--rooot` / `--fail-on-issue` 全 rc=0 |
| P0 | `--root` 缺值崩溃到 rc=1 | 抛 `paths[0] must be of type string` |
| P0 | 阈值被 parseInt 悄悄截断 | `--min-tests 12abc` → 12 |
| P0 | `process.exit(main(...))` 截断 stdout | `--json` 大输出在管道里残缺 → 下游 JSON.parse 炸 |
| P1 | run 模式吞掉全部门禁参数 | `run --min-tests 99999` → rc=0 |
| P1 | engines 谎报 | 声明 `>=14`，但 run 依赖 `node --test`（需 18+） |
| P1 | README 包名撞车 | npm 上 `testlite` 归 bdsomer，`npm i -g testlite` 装错并抢占同名命令 |
| P1 | 零 LICENSE / 零 .gitignore / 零 CI | 仓库只有 4 个文件 |

修复要点：
- 新增 `scanBasis()`：JS/TS 文件数为 0 → `basisComplete=false`，健康分显示 `n/a`，门禁无条件 rc=2，
  报告带 `basisReason` 告诉用户「请确认 --root 是否指向 Node 项目」。
- 测试目录判定改为对 `path.relative(root, full)` 的目录段做匹配，不再看绝对路径。
- `parseArgs` 重写：`UsageError` + 严格取参（支持 `--opt=v`）+ 未知选项/命令/重复命令全退 2。
- `parseNumberStrict`：`/^[+-]?\d+(\.\d+)?$/` 全量匹配，拒绝 `12abc` / `0x10` / `1e3` / `Infinity`。
- 门禁前置校验：参数错就先退 2，绝不先体检后才发现参数没传。
- 主入口改 `process.exitCode = main(...)`。
- run 模式复用同一套门禁逻辑，与 doctor 完全一致。

### 核验

- 单测：6 组 → 10 组（新增 `scanBasis` / `parseNumberStrict` / `parseArgs` / 嵌套路径回归专测），全绿。
- 入口冒烟：`test/smoke-cli.js` 9 组，**spawn 级真跑进程**校验退出码契约，全绿。
- 变异测试：10/10 全拦，连续两轮稳定。
- 自检：`node index.js doctor --root . --min-tests 1` → rc=0，健康分 80，零依赖自证通过。
- CI：Node 18/20/22 × ubuntu/windows 全矩阵 + 零依赖自证 + README 一致性 + dogfood。

### 自身错误与倾向（本轮 6 次）

1. 写完严格取参后忘了让循环跳过已消费的值 token → `--root <dir>` 的 `<dir>` 被当未知命令。探针当场发现。
2. **第一版 smoke 的 `--json` 完整性用例是假门禁**：输出仅 449 字节，管道缓冲够大，
   `process.exit` 的截断根本触发不了。改成造 300 个超大测试文件（JSON 到 76KB）才真正测出来。
   → 教训：**造不出足够大的输出，就等于没测截断**。
3. 重建 base commit 时误把探针残留 `j1.txt` 纳入版本历史，为清掉它执行 `git clean -fd` 把整个工作目录连同
   已完成的改动一起删了，只能从 `/tmp` 备份抢救 `index.js`、重写 `test.js` / README / package.json / CI / 状态文件。
   → 教训：**动手前先确认 base commit 只含远端真实文件**；要删文件应把它排除在推送清单外走 PR diff，绝不 `git clean`。
4. 变异测试脚本把 `__dirname` 写死，换目录运行直接 ENOENT 崩，报出「0 FAIL」假象。
5. M1 变异连续逃逸两次才想明白：`--bogus` 有「未知选项」与「未知命令」两条等价兜底分支（rc 都是 2），
   我第一反应是「门禁弱」，实际是**变异设计错误**。改断言（区分错误消息类型）后才拦住。
   → 教训：**变异逃逸先分清是「门禁弱」还是「变异等价」**，别急着加断言。
6. 单测里凭印象写 `jsLikeFound` / `srcLines` 的期望值，连错两次（3→4→3、3→5），
   实际都是靠跑一遍看真值才定位。→ **断言里的数字不许猜，必须跑出来**。

### 平台特性记录

Windows 上 `process.exit()` 即使输出 978KB 也不丢（实测 N=4000 个超大测试文件 = 978KB，JSON 完整）。
所以「截断 stdout」这类门禁在 Windows 上**运行时断言形同虚设**，必须用源码级断言兜底。

同理，等价变异（多个分支行为一致时只打断一处）杀不掉是正常的，不能误判成「门禁弱」。
区分办法：看被保留的那条分支是否真能覆盖同一输入。
