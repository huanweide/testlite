#!/usr/bin/env node
'use strict';

/*
 * testlite 入口链路冒烟（spawn 级，零依赖）
 *
 * 为什么单独一个文件：单测测的是导出的函数，根本不碰 process.exit。
 * 而"门禁"的价值 100% 体现在退出码上 —— 退出码错了，单测全绿也没用。
 * 本脚本用 child_process.spawnSync 真跑 index.js，逐条断言 rc / stdout / stderr。
 *
 * 运行：node test/smoke-cli.js   —— 全绿 exit 0，任一失败 exit 1
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'index.js');
let pass = 0;
function ok(name) { pass++; console.log('  [OK] ' + name); }

function mk(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-smoke-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return tmp;
}

function run(args) {
  const r = spawnSync(process.execPath, [CLI].concat(args), { encoding: 'utf8' });
  return { rc: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const ZERO_PROJ = mk({
  'package.json': JSON.stringify({ name: 'zt' }),
  'src/a.js': 'module.exports=1;\n'
});
const GOOD_PROJ = mk({
  'package.json': JSON.stringify({ name: 'gp', nyc: {} }),
  'src/a.js': 'module.exports=1;\n',
  'test/a.test.js': "const a=require('assert');\ntest('x',()=>a.ok(true));\n"
});
const EMPTY_PROJ = mk({ 'package.json': JSON.stringify({ name: 'empty' }) });
// 纯 Python 项目：JS/TS 文件数为 0 => 扫描基线为空
const PY_PROJ = mk({
  'pyproject.toml': '[project]\nname="p"\n',
  'app/core.py': 'def add(a,b):\n    return a+b\n',
  'test_core.py': 'def test_add():\n    assert add(1,2)==3\n'
});
// root 自身的绝对路径里必须带 test 路径段，早期版本对绝对路径做判定会中招
function mkUnderTestDir(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-nested-'));
  const root = path.join(tmp, 'test');
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}
const NESTED_ROOT = mkUnderTestDir({
  'package.json': JSON.stringify({ name: 'nested' }),
  'src/index.js': 'const a=1;\nconst b=2;\nmodule.exports=a+b;\n',
  'src/util.js': 'module.exports=1;\n'
});

// --- 1. 基本退出码契约 ---------------------------------------------------
(function basicContract() {
  assert.strictEqual(run(['--help']).rc, 0, '--help 应 0');
  assert.strictEqual(run(['doctor', '--root', GOOD_PROJ]).rc, 0, '健康项目 doctor 应 0');
  assert.strictEqual(run(['doctor', '--root', '/no/such/dir/xyz']).rc, 2, '无效 root 应 2');
  assert.strictEqual(run(['doctor', '--root', ZERO_PROJ, '--fail-on-issues']).rc, 2, '零测试+门禁 应 2');
  ok('基本退出码契约（--help / 健康项目 / 无效 root / 零测试门禁）');
})();

// --- 2. 未知选项与未知命令必须退 2 ---------------------------------------
(function unknownArgs() {
  const cases = [
    [['doctor', '--root', GOOD_PROJ, '--bogus'], '未知长选项'],
    [['doctor', '--root', GOOD_PROJ, '--fail-on-issue'], '选项名拼错（少个 s）'],
    [['doctor', '--root', GOOD_PROJ, '--rooot', GOOD_PROJ], '选项名拼错（多写 o）'],
    [['frobnicate', '--root', GOOD_PROJ], '未知命令'],
    [['doctor', 'run', '--root', GOOD_PROJ], '一次传两个命令'],
    [['doctor', '--root', GOOD_PROJ, '--json=1'], '--json 不接受取值'],
    [['doctor', '--root', GOOD_PROJ, '--fail-on-issues=1'], '--fail-on-issues 不接受取值']
  ];
  const LEGAL = new Set(['doctor', 'run', '--json', '--root', '--min-tests', '--min-density', '--fail-on-issues', '--help', '-h']);
  for (const [args, label] of cases) {
    const r = run(args);
    assert.strictEqual(r.rc, 2, label + ' 应退 2，实际 rc=' + r.rc);
    assert.ok(/参数错误/.test(r.err), label + ' 应报参数错误，实际 stderr=' + JSON.stringify(r.err.slice(0, 120)));
    // 错误消息必须指名道姓说出是哪个非法 token 出错，不能只丢一句「未知命令」。
    // 原因：--bogus 有「未知选项」与「未知命令」两条兜底分支，若只断言 rc=2，
    // 变异掉其中一条照样全绿（第一版变异测试就是这么逃逸的）。
    const illegal = args.filter(a => !LEGAL.has(a) && !LEGAL.has(a.split('=')[0]) && !fs.existsSync(a));
    for (const tok of illegal) {
      assert.ok(r.err.indexOf(tok) >= 0, label + ' 错误消息应指名出错 token "' + tok +
        '"，实际 stderr=' + JSON.stringify(r.err.slice(0, 160)));
      // 以 '-' 开头的非法 token 必须报「未知选项」，不能混进「未知命令」——
      // 两条分支 rc 都是 2，只有消息类型能把它们区分开（变异测试据此才拦得住）。
      if (/^-{1,2}[a-z]/.test(tok)) {
        assert.ok(/未知选项/.test(r.err), label + ' 以 - 开头的 "' + tok +
          '" 应报「未知选项」，实际 stderr=' + JSON.stringify(r.err.slice(0, 160)));
      } else {
        assert.ok(/未知命令/.test(r.err), label + ' 非选项 token "' + tok +
          '" 应报「未知命令」，实际 stderr=' + JSON.stringify(r.err.slice(0, 160)));
      }
    }
  }
  ok('未知选项 / 未知命令 / 拼错选项名 / 重复命令 一律退 2（' + cases.length + ' 例）');
})();

// --- 3. 缺值与非数字阈值必须退 2 -----------------------------------------
(function badValues() {
  const cases = [
    [['doctor', '--root'], '--root 缺值'],
    [['doctor', '--root', GOOD_PROJ, '--min-tests'], '--min-tests 缺值'],
    [['doctor', '--root', GOOD_PROJ, '--min-density'], '--min-density 缺值'],
    [['doctor', '--root', GOOD_PROJ, '--min-tests', 'abc'], '--min-tests abc'],
    [['doctor', '--root', GOOD_PROJ, '--min-tests', '12abc'], '--min-tests 12abc'],
    [['doctor', '--root', GOOD_PROJ, '--min-tests', '1.5'], '--min-tests 1.5（非整数）'],
    [['doctor', '--root', GOOD_PROJ, '--min-tests', '-3'], '--min-tests -3（负数）'],
    [['doctor', '--root', GOOD_PROJ, '--min-density', 'abc'], '--min-density abc'],
    [['doctor', '--root', GOOD_PROJ, '--min-density', 'NaN'], '--min-density NaN'],
    [['doctor', '--root', GOOD_PROJ, '--min-density', '-1'], '--min-density -1（负数）'],
    [['doctor', '--root', GOOD_PROJ, '--min-density', 'Infinity'], '--min-density Infinity']
  ];
  for (const [args, label] of cases) {
    const r = run(args);
    assert.strictEqual(r.rc, 2, label + ' 应退 2，实际 rc=' + r.rc);
  }
  ok('缺值 / 非数字 / 非整数 / 负数 / Infinity 阈值一律退 2（' + cases.length + ' 例）');
})();

// --- 4. 扫描基线为空必须失败，绝不"零对象即通过" --------------------------
(function emptyBasis() {
  for (const [proj, label] of [[EMPTY_PROJ, '空目录项目'], [PY_PROJ, '纯 Python 项目']]) {
    const r = run(['doctor', '--root', proj, '--json']);
    assert.strictEqual(r.rc, 2, label + ' 扫描基线为空应退 2，实际 rc=' + r.rc);
    const j = JSON.parse(r.out);
    assert.strictEqual(j.basisComplete, false, label + ' basisComplete 应为 false');
    assert.strictEqual(j.healthScore, 0, label + ' 基线为空时健康分应为 0');
    assert.ok(/empty-scan/.test(j.warnings.join('|')), label + ' 应有 empty-scan 警告');
    assert.strictEqual(j.gate.passed, false, label + ' 门禁不应通过');
    // 关键回归：早期版本此处报「健康分 10/100 · 警告 无 · 门禁 通过 · rc 0」
    assert.ok(!/门禁: 通过/.test(r.out), label + ' 不得出现「门禁: 通过」字样');
  }
  // 不带任何门禁参数也必须失败
  assert.strictEqual(run(['doctor', '--root', PY_PROJ]).rc, 2, '纯 Python 项目裸 doctor 应退 2');
  ok('扫描基线为空（空目录 / 纯 Python 项目）门禁无条件失败，不发健康分');
})();

// --- 5. root 路径含 test/ 时源码不得被误判为测试 --------------------------
(function nestedTestDir() {
  const r = run(['doctor', '--root', NESTED_ROOT, '--json']);
  assert.strictEqual(r.rc, 0, '正常项目应 0，实际 ' + r.rc);
  const j = JSON.parse(r.out);
  assert.strictEqual(j.srcFiles, 2, '源码应识别为 2 个，实际 ' + j.srcFiles);
  assert.strictEqual(j.testFiles, 0, '测试文件应为 0，实际 ' + j.testFiles);
  assert.strictEqual(j.density, 0, '零测试时密度应为 0，实际 ' + j.density);
  assert.ok(j.warnings.some(w => w.startsWith('zero-test')), '应报 zero-test');
  assert.ok(!j.warnings.some(w => w.startsWith('low-density')),
    '零测试项目不应同时报 low-density（早期版本会误报）');
  ok('root 路径含 test/ 时源码不被误判为测试（回归：曾整棵树被当测试）');
})();

// --- 6. run 模式也必须吃门禁参数（早期版本静默忽略） -----------------------
(function runModeGate() {
  const big = run(['run', '--root', GOOD_PROJ, '--json', '--min-tests', '99999']);
  assert.strictEqual(big.rc, 2, 'run --min-tests 应生效并退 2，实际 ' + big.rc);
  const j = JSON.parse(big.out);
  assert.strictEqual(j.mode, 'run', '应为 run 模式报告');
  assert.strictEqual(j.gate.passed, false, 'run 门禁不应通过');
  assert.ok(j.gate.failures.some(f => f.indexOf('--min-tests') >= 0), 'run 门禁失败原因应含 --min-tests');
  // run 模式的 JSON 也要带 basisComplete，下游才知可信度
  assert.ok('basisComplete' in j, 'run 报告应含 basisComplete');
  // run 模式参数错误也必须退 2
  assert.strictEqual(run(['run', '--root', GOOD_PROJ, '--bogus']).rc, 2, 'run 模式未知选项应退 2');
  // run 模式遇扫描基线为空也必须失败
  assert.strictEqual(run(['run', '--root', PY_PROJ]).rc, 2, 'run 模式纯 Python 项目应退 2');
  ok('run 模式同样吃 --min-tests/--min-density/--fail-on-issues（回归：曾静默忽略）');
})();

// --- 7. --json 输出必须完整可解析（回归：process.exit 截断 stdout） ---------
(function jsonIntegrity() {
  // 必须用「大到撑破管道缓冲」的输出，否则 process.exit 的截断不会被触发，
  // 断言就成了永远绿的假门禁（第一版用小项目，变异测试直接逃逸）。
  // 造大输出的关键是「超大测试文件」才会逐条进 JSON 的 bigTestFiles：
  // 只堆小文件的话 JSON 里只有个计数，300 个文件也才 453 字节（自己踩过）。
  const many = {};
  for (let i = 0; i < 300; i++) {
    many['test/big' + i + '.test.js'] = "const a=require('assert');\ntest('t" + i + "',()=>a.ok(1));\n" +
      Array.from({ length: 620 }, (_, k) => '// filler line ' + k).join('\n');
  }
  const BIG_PROJ = mk(Object.assign({
    'package.json': JSON.stringify({ name: 'big', nyc: {} }),
    'src/a.js': 'module.exports=1;\n'
  }, many));

  for (const [args, label] of [
    [['doctor', '--root', GOOD_PROJ, '--json'], '小项目通过场景'],
    [['doctor', '--root', ZERO_PROJ, '--fail-on-issues', '--json'], '门禁失败场景'],
    [['doctor', '--root', BIG_PROJ, '--json'], '大输出场景（300 个超大测试文件）'],
    [['run', '--root', GOOD_PROJ, '--json'], 'run 模式']
  ]) {
    const r = run(args);
    let parsed = null;
    try { parsed = JSON.parse(r.out); } catch (e) {
      throw new Error(label + ' --json 输出被截断，无法解析：' + r.out.length + ' 字节，末尾=' +
        JSON.stringify(r.out.slice(-80)));
    }
    assert.ok(parsed.gate, label + ' 报告应含 gate 字段');
  }
  // 走管道（不落文件）也一样完整。
  // 注意：大输出用「结构 + 相对字节量」判定，不能写死绝对字节阈值。
  // 首版写了 `> 60000 字节`，结果 Ubuntu 全红：同样 300 个文件，Linux 路径更短、
  // JSON 只有 49KB（Windows 76KB）→ 跨平台阈值即假门禁（自己踩过）。
  const piped = spawnSync(process.execPath, [CLI, 'doctor', '--root', BIG_PROJ, '--json'],
    { encoding: 'utf8' });
  const parsedBig = JSON.parse(piped.stdout);
  assert.strictEqual(parsedBig.bigTestFiles.length, 300,
    '大输出场景应逐条列出 300 个超大测试文件，实际 ' + parsedBig.bigTestFiles.length);
  // 每个条目平均 > 100 字节 → 总量必然远大于 10KB，足以压破管道缓冲且跨平台稳定
  assert.ok(piped.stdout.length > 30000,
    '大输出场景 JSON 总量应 >30KB（300 条 × >100B），实际 ' + piped.stdout.length + ' 字节');
  console.log('  [INFO] --json 大输出场景：' + parsedBig.bigTestFiles.length + ' 条 bigTestFiles / ' +
    piped.stdout.length + ' 字节完整解析 + 源码级 exitCode 门禁');

  // 源码级门禁：主入口不得用 process.exit()。
  // 为什么不用运行时断言：Windows 管道实测到 ~978KB 才截断（多数情况压根不截断），
  // 运行时断言在 Windows 上形同虚设、变异测试直接逃逸（自己踩过）。
  // process.exit() 截断 stdout 是跨平台通病，源码级断言才是稳定门禁。
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(!/process\.exit\s*\(\s*main\s*\(/.test(src),
    'index.js 不得用 process.exit(main(...))：会截断尚未 flush 的 stdout，--json 下游 JSON.parse 会炸；应用 process.exitCode');
  assert.ok(/process\.exitCode\s*=\s*main\s*\(/.test(src), 'index.js 应以 process.exitCode 设置退出码');
  ok('--json 输出完整可解析（回归：process.exit 曾截断 stdout）');
})();

// --- 8. --opt=v 内联形式 --------------------------------------------------
(function inlineForm() {
  const r = run(['doctor', '--root=' + GOOD_PROJ, '--min-tests=99999']);
  assert.strictEqual(r.rc, 2, '--root= 内联 + 高阈值应退 2，实际 ' + r.rc);
  assert.strictEqual(run(['doctor', '--root=' + GOOD_PROJ]).rc, 0, '--root= 内联 + 健康项目应 0');
  assert.strictEqual(run(['doctor', '--root=' + GOOD_PROJ, '--min-tests=abc']).rc, 2, '内联非数字应退 2');
  ok('--opt=value 内联形式正确消费取值');
})();

// --- 9. 自身 dogfood：testlite 体检 testlite ------------------------------
(function dogfood() {
  const r = run(['doctor', '--root', path.join(__dirname, '..'), '--json']);
  assert.strictEqual(r.rc, 0, 'testlite 体检自身应通过门禁，实际 ' + r.rc);
  const j = JSON.parse(r.out);
  assert.strictEqual(j.basisComplete, true, '自身扫描基线应完整');
  // 门禁阈值对自身同样要成立：测试函数数不得为 0，否则"有测试文件"是假的
  assert.ok(j.estTestFns > 0, '自身应检出测试函数，实际 ' + j.estTestFns);
  assert.ok(j.testFiles >= 2, '自身应有 test.js 与 test/smoke-cli.js 两个测试文件，实际 ' + j.testFiles);
  assert.strictEqual(j.srcFiles, 1, '自身源码应只有 index.js 一个，实际 ' + j.srcFiles);
  // 零依赖自证：index.js 不得 require 任何非内置模块
  const src = fs.readFileSync(CLI, 'utf8');
  const reqs = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
  const builtin = new Set(['fs', 'path', 'child_process', 'os', 'assert', 'util', 'url', 'module']);
  for (const m of reqs) {
    assert.ok(builtin.has(m), 'index.js 不得依赖第三方模块: ' + m);
  }
  const pkgRaw = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgRaw);
  assert.strictEqual(Object.keys(pkg.dependencies || {}).length, 0, 'package.json 不得有 dependencies');
  assert.strictEqual(Object.keys(pkg.devDependencies || {}).length, 0, 'package.json 不得有 devDependencies');
  console.log('  [INFO] 自身：测试文件 ' + j.testFiles + ' · 源码文件 ' + j.srcFiles +
    ' · 健康分 ' + j.healthScore + ' · require 全内置');
  ok('dogfood：自身体检通过 + 零依赖自证');
})();

console.log('\ntestlite 入口冒烟：' + pass + ' 组全绿');
