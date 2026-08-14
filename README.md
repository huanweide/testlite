# testlite

零依赖单文件 Node CLI · 测试卫生体检中心。

devdoctor 看「依赖干不干净」，testlite 看「测试健不健康」——两者拼成代码健康 family 的完整组合叙事。

## 为什么需要它

- 现有测试统计（jest --coverage / istanbul / c8）要么要装依赖、要么配置重。
- 裸 `npm test` 只跑不体检，CI 里想加一条「测试卫生门禁」得写一堆脚本。
- testlite 零依赖、单文件、开箱即跑，一键看测试卫生 + 可进 CI 的门禁。

## 安装

```bash
npm i -g testlite
# 或直接走 npx（无需安装）
npx testlite doctor
```

## 用法

```bash
# 静态体检（默认）
testlite doctor [--root <dir>] [--json] [--min-tests <n>] [--min-density <n>] [--fail-on-issues]

# 可选增强：用 Node 内置 test runner 真跑并解析
testlite run [--root <dir>] [--json]
```

doctor 静态体检覆盖：

- 测试框架识别（vitest / jest / mocha / ava / playwright / cypress / node:test / npm-test）
- 测试发现（多命名约定：\*.test.js / \*.spec.ts / test\_foo.js / `__tests__` / test|tests|spec 目录）
- 测试密度估算（测试函数数 / 千行源码）
- 零测试警告（有源码却零测试文件）
- 超大测试文件警告（行数 > 600 或体积 > 60KB）
- 覆盖率工具配置检测（nyc / c8 / jest.collectCoverage / .nycrc）
- 综合健康分（0–100）

run 可选增强：spawn `node --test` 真跑并解析 tests/pass/fail/skipped/todo + 总耗时；若项目用 jest/vitest 等导致解析不到，自动降级为静态体检，不崩。

## CI 门禁

```bash
# 测试函数数不足 10，或存在任何体检警告（零测试/超大文件/低密度/无覆盖率）→ exit 2
testlite doctor --min-tests 10 --fail-on-issues
```

阈值参数一律做 `Number.isFinite` 校验，非整数直接 exit 2，绝不静默放行。

## 差异化

| 工具 | 零依赖 | 单文件 | 测试卫生体检 | CI 门禁 |
|------|--------|--------|--------------|---------|
| jest --coverage | 否 | 否 | 仅覆盖率 | 需配置 |
| c8 / istanbul | 否 | 否 | 覆盖率 | 需配置 |
| leasot | 否 | 否 | TODO 扫描 | 需装 |
| **testlite** | **是** | **是** | **是（密度/零测试/超大/覆盖率）** | **是（内置）** |

## 设计铁律（family 方法沉淀）

- 纯本地、零依赖、离线、单文件，跨平台（Windows posix 路径）。
- 门禁阈值 `Number.isFinite` 校验，非整数 exit 2，绝不静默放行。
- root 必须 `statSync` 先验存在且为目录，错误路径不谎报「通过」。
- 大文件（>5MB）跳过防 OOM；坏 JSON 静默跳过不崩。

## License

MIT
