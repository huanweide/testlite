<!-- badges -->
[![License](https://img.shields.io/github/license/huanweide/testlite)](LICENSE)
[![Stars](https://img.shields.io/github/stars/huanweide/testlite)](https://github.com/huanweide/testlite/stargazers)
[![Engineering Health Family](https://img.shields.io/badge/Engineering%20Health%20Family-18%20axes-22c55e)](https://github.com/huanweide/family-showcase)
<!-- /badges -->

**🔧 Part of the [Engineering Health Family](https://github.com/huanweide/family-showcase)** (18 zero-dependency checkup axes). Standalone tool — see [doctors](https://github.com/huanweide/doctors) (monorepo) and [enghealth](https://github.com/huanweide/enghealth) (unified runner).

# testlite

零依赖单文件 Node CLI · 测试卫生体检中心。

devdoctor 看「依赖干不干净」，testlite 看「测试健不健康」——两者拼成代码健康 family 的完整组合叙事。

## ⚠️ 安装前必读：本项目尚未发布到 npm，npm 上的 `testlite` 是别人的包

`npm view testlite` 的真实输出（2026-10 实测）：

```
testlite@2.0.2 | MIT | deps: none | versions: 7
Easy, lightweight testing
https://github.com/bdsomer/testlite#readme
maintainers: bdsomer <bdsomer@gmail.com>
```

**那是另一个作者的无关包**（bdsomer 的测试辅助库）。执行 `npm i -g testlite` 或 `npx testlite` 会装错东西并抢占同名命令。所以：

```bash
# 推荐：直接克隆使用（零依赖，无需 npm install）
git clone https://github.com/huanweide/testlite.git
node testlite/index.js doctor --root <你的项目>

# 或用 npx 直接跑 GitHub 源（不经过 npm 注册表，不会撞名）
npx github:huanweide/testlite doctor --root <你的项目>
```

## 为什么需要它

- 现有测试统计（jest --coverage / istanbul / c8）要么要装依赖、要么配置重。
- 裸 `npm test` 只跑不体检，CI 里想加一条「测试卫生门禁」得写一堆脚本。
- testlite 零依赖、单文件、开箱即跑，一键看测试卫生 + 可进 CI 的门禁。

## 用法

```bash
# 静态体检（默认）
testlite doctor [--root <dir>] [--json] [--min-tests <n>] [--min-density <n>] [--fail-on-issues]

# 可选增强：用 Node 内置 test runner 真跑并解析
testlite run    [--root <dir>] [--json] [--min-tests <n>] [--min-density <n>] [--fail-on-issues]
```

也支持 `--root=<dir>` 内联写法。

doctor 静态体检覆盖：

- 测试框架识别（vitest / jest / mocha / ava / playwright / cypress / node:test / npm-test）
- 测试发现（多命名约定：\*.test.js / \*.spec.ts / test\_foo.js / `__tests__` / test|tests|spec 目录）
- 测试密度估算（测试函数数 / 千行源码）
- 零测试警告（有源码却零测试文件）
- 超大测试文件警告（行数 > 600 或体积 > 60KB）
- 覆盖率工具配置检测（nyc / c8 / jest.collectCoverage / .nycrc）
- 综合健康分（0–100）

run 可选增强：spawn `node --test` 真跑并解析 tests/pass/fail/skipped/todo + 总耗时；若项目用 jest/vitest 等导致解析不到，自动降级为静态体检，不崩。

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 体检通过 |
| 1 | 内部异常 |
| 2 | 参数错误 / root 无效 / 门禁不达标 |

**未知选项、缺值、非数字阈值一律退 2。** 门禁参数写错 = 门禁不存在，绝不静默当没传：

```bash
$ testlite doctor --bogus           # rc=2，指名报「未知选项: --bogus」
$ testlite doctor --min-tests 12abc # rc=2（不是被截成 12）
$ testlite doctor --root            # rc=2（缺值，不崩溃）
```

## CI 门禁

```bash
# 测试函数数不足 10，或存在任何体检警告（零测试/超大文件/低密度/无覆盖率）→ exit 2
testlite doctor --min-tests 10 --fail-on-issues
```

`run` 与 `doctor` **同样吃全部门禁参数**（早期版本 `run` 会静默忽略它们，等于门禁不存在）。

### 「门禁未启用」≠「门禁通过」

不传任何阈值时，工具**一条门禁都不会生效**，退出码恒为 0。早期版本此时照样打印「门禁: 通过」，
用这两个字让用户误以为 CI 会拦住问题（实测：零测试项目健康分 10/100 也显示「通过」）。

现在会明确区分：

```
$ testlite doctor --root .        # 没传阈值
  门禁: 未启用（未传任何阈值，退出码恒为 0；加 --min-tests / --min-density / --fail-on-issues 才拦得住）

$ testlite doctor --root . --min-tests 1
  门禁: 通过
```

`--json` 里对应 `gate.active` / `gate.configured` / `gate.passed` 三个字段：
`configured` 表示用户是否真的配了阈值，`passed` 只在 `active=true` 时才有意义。

## 扫描基线可信度（`basisComplete`）

体检工具最恶劣的失败模式是「扫了 0 个对象却报通过」。testlite 只体检 JS/TS 项目；若传入的 root 下**一个 JS/TS 文件都没有**（例如误传了 Python 项目目录、空目录），旧版本会拿 0/0 算出「健康分 10/100 · 警告 无 · 门禁 通过」并退 0。

现在这种情况下：

- 健康分显示 `n/a（扫描基线为空，不发分）`，JSON 里 `healthScore: 0`
- 报告与 JSON 都带 `basisComplete: false` 与 `basisReason`
- **门禁无条件失败**（rc=2），无论是否显式传了阈值

下游若要串多个门禁工具，用 `basisComplete` 判断这份结论能不能信。

## 差异化

| 工具 | 零依赖 | 单文件 | 测试卫生体检 | CI 门禁 |
|------|--------|--------|--------------|---------|
| jest --coverage | 否 | 否 | 仅覆盖率 | 需配置 |
| c8 / istanbul | 否 | 否 | 覆盖率 | 需配置 |
| leasot | 否 | 否 | TODO 扫描 | 需装 |
| **testlite** | **是** | **是** | **是（密度/零测试/超大/覆盖率）** | **是（内置）** |

## 设计铁律（family 方法沉淀）

- 纯本地、零依赖、离线、单文件，跨平台（Windows posix 路径）。
- 未知选项 / 缺值 / 非数字阈值一律 exit 2，绝不静默放行。
- 阈值只接受完整数字：`12abc`、`1e3`、`0x10`、`Infinity` 全部拒绝（`parseInt` 会把它们悄悄截断或转成怪值）。
- **扫描基线为空必须报错**，绝不「零对象即通过」；结论带 `basisComplete` 供下游判断可信度。
- 测试目录判定只看 root 之下的**相对**路径段——root 自身路径里含 `test/` 不应把整棵源码树误判成测试。
- root 必须 `statSync` 先验存在且为目录，错误路径不谎报「通过」。
- 主入口用 `process.exitCode` 而非 `process.exit()`：后者会截断尚未 flush 的 stdout，`--json` 在管道里会残缺到 `JSON.parse` 直接炸。
- 大文件（>5MB）跳过防 OOM；坏 JSON 静默跳过不崩。

## 环境要求

Node.js >= 18。`run` 子命令依赖 Node 内置 test runner（`node --test`），更早的版本无法真实执行。

## 测试与门禁

```bash
npm test              # 单元测试 + 入口冒烟，两道都必须绿
node test.js          # 单元测试（10 组）
node test/smoke-cli.js  # 入口冒烟（spawn 级，9 组，校验真实退出码）
```

CI 在 Node 18/20/22 × ubuntu/windows 上跑全矩阵，另加零依赖自证、README 一致性与 dogfood 自检。

> 为什么单测之外还要 spawn 级冒烟：`node test.js` 只测导出的函数，**根本不碰 `process.exit`**。门禁的价值 100% 在退出码上，退出码错了单测全绿也没用。
> 这套门禁经过 10 例变异测试验证（逐个注入缺陷确认能被拦住），没有变异验证的门禁等于没有门禁。

## License

MIT

---

## 作者

由 **ReTr · 樊斯瑞** 维护 · [GitHub 主页](https://github.com/huanweide)

## 赞助支持

如果这个项目帮到了你，欢迎 [点 Star](https://github.com/huanweide/testlite) 支持；也可微信扫码自愿赞助（收款码见 `sponsor/wechat-qr.png`，作者本人带 Tri 水印的码，纯静态图片、不含任何密钥）。

## 许可证

详见 [LICENSE](LICENSE)。
---

## 便携性 · 零依赖承诺

- 零运行时依赖：只用一个 Node 内置模块，无需 `npm install`。
- 单文件：整个工具就是一个 `index.js`，复制进任何仓库即可用。
- 离线 / 跨平台：Node 18+ 即可，不联网、不挑系统。
- 一键跑：`node index.js --root ./src`（详见上方用法）。

← [回到代码健康家族总览](https://github.com/huanweide/family-showcase)
