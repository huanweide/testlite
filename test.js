#!/usr/bin/env node
'use strict';

/*
 * testlite 自包含单测（零依赖，仅用 node:assert + node:child_process）
 * 运行：node test.js   —— 全绿 exit 0，任一失败 exit 1
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const D = require('./index.js');
const CLI = path.join(__dirname, 'index.js');

let pass = 0;
function ok(name) { pass++; console.log('  [OK] ' + name); }

function makeProject(structure) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-'));
  for (const [rel, content] of Object.entries(structure)) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return tmp;
}

// 1. classifyFramework ----------------------------------------------------
(function checkFramework() {
  assert.strictEqual(D.classifyFramework('/x', { name: 'x' }), null);
  assert.strictEqual(D.classifyFramework('/x', { devDependencies: { vitest: '^1' } }), 'vitest');
  assert.strictEqual(D.classifyFramework('/x', { devDependencies: { jest: '^29' } }), 'jest');
  assert.strictEqual(D.classifyFramework('/x', { devDependencies: { mocha: '^10' } }), 'mocha');
  assert.strictEqual(D.classifyFramework('/x', { devDependencies: { ava: '^5' } }), 'ava');
  assert.strictEqual(D.classifyFramework('/x', { scripts: { test: 'jest' } }), 'jest');
  assert.strictEqual(D.classifyFramework('/x', { scripts: { test: 'mocha' } }), 'mocha');
  assert.strictEqual(D.classifyFramework('/x', { scripts: { test: 'node --test' } }), 'node:test');
  assert.strictEqual(D.classifyFramework('/x', { scripts: { test: 'npm test' } }), 'npm-test');
  ok('classifyFramework 各框架识别正确（含 scripts.test 命令识别）');
})();

// 2. coverageConfigured ---------------------------------------------------
(function checkCoverage() {
  assert.strictEqual(D.coverageConfigured('/x', { nyc: {} }), true);
  assert.strictEqual(D.coverageConfigured('/x', { c8: {} }), true);
  assert.strictEqual(D.coverageConfigured('/x', { jest: { collectCoverage: true } }), true);
  assert.strictEqual(D.coverageConfigured('/x', { jest: { collectCoverage: false } }), false);
  assert.strictEqual(D.coverageConfigured('/x', null), false);
  ok('coverageConfigured 识别 nyc/c8/jest 字段');
})();

// 3. discoverTests 真实扫描 -----------------------------------------------
(function checkDiscover() {
  let big = '';
  for (let i = 0; i < 650; i++) big += '// line ' + i + (i < 649 ? '\n' : '');
  const tmp = makeProject({
    'package.json': JSON.stringify({ name: 'demo' }),
    'src/index.js': 'const a=1;\nconst b=2;\nexports.add=(x,y)=>x+y;',
    'test/index.test.js': "const t=require('assert');\ntest('a',()=>{});\nit('b',()=>{});\ntest('c',()=>{});\n",
    'test/big.test.js': big
  });
  const d = D.discoverTests(tmp);
  assert.ok(d.testFiles.length >= 2, '应发现至少 2 个测试文件，实际 ' + d.testFiles.length);
  assert.strictEqual(d.srcFiles.length, 1);
  assert.strictEqual(d.estTestFns, 3);
  assert.strictEqual(d.srcLines, 3);
  assert.strictEqual(d.bigTestFiles.length, 1);
  assert.strictEqual(d.bigTestFiles[0].lines, 650);
  // jsLikeFound = root 下 JS/TS 文件总数：1 源码 + 2 测试 = 3
  assert.strictEqual(d.jsLikeFound, 3, 'JS/TS 文件总数应为 3，实际 ' + d.jsLikeFound);
  ok('discoverTests 真实计数（测试/源码/函数/行/超大/基线文件数）正确');
})();

// 3b. root 路径含 test/ 不得误判（回归） -----------------------------------
(function checkNestedRoot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-'));
  const root = path.join(tmp, 'test');   // root 绝对路径带 test 段
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const a=1;\nconst b=2;\n');
  fs.writeFileSync(path.join(root, 'src', 'b.js'), 'const c=3;\n');
  const d = D.discoverTests(root);
  assert.strictEqual(d.srcFiles.length, 2, '源码应识别 2 个，实际 ' + d.srcFiles.length);
  assert.strictEqual(d.testFiles.length, 0, '测试应为 0，实际 ' + d.testFiles.length);
  // countLines 对无尾换行的文件返回 行数+1（'\n' 个数 + 1），此处 2 个文件共 5
  assert.strictEqual(d.srcLines, 5, '源码行数应为 5，实际 ' + d.srcLines);
  ok('discoverTests root 路径含 test/ 时不误判源码为测试');
})();

// 4. scoreHealth ----------------------------------------------------------
(function checkScore() {
  const okBasis = { basisComplete: true, basisReason: null };
  const zero = { testFiles: [], srcFiles: ['a.js'], estTestFns: 0, srcLines: 10, bigTestFiles: [] };
  const h0 = D.scoreHealth(zero, false, okBasis);
  assert.strictEqual(h0.zeroTest, true);
  assert.ok(h0.warnings.some(w => w.startsWith('zero-test')));
  assert.ok(h0.score <= 20, '零测试应压低健康分，实际 ' + h0.score);

  const good = { testFiles: ['t.js'], srcFiles: ['s.js'], estTestFns: 20, srcLines: 1000, bigTestFiles: [] };
  const h1 = D.scoreHealth(good, true, okBasis);
  assert.strictEqual(h1.zeroTest, false);
  assert.ok(h1.score >= 80, '良好项目健康分应高，实际 ' + h1.score);
  assert.ok(h1.density > 0);

  // 非 test()/it() 风格（assert 块）项目：应给 no-test-fn 而非 low-density
  const assertStyle = { testFiles: ['t.js'], srcFiles: ['s.js'], estTestFns: 0, srcLines: 100, bigTestFiles: [] };
  const h2 = D.scoreHealth(assertStyle, false, okBasis);
  assert.ok(h2.warnings.some(w => w.startsWith('no-test-fn')), '应检出 no-test-fn 警告，实际 ' + JSON.stringify(h2.warnings));
  assert.ok(!h2.warnings.some(w => w.startsWith('low-density')), '不应误报 low-density');

  // 扫描基线为空：不得发分，且必须带 empty-scan 警告
  const emptyBasis = { basisComplete: false, basisReason: 'root 下未发现任何 JS/TS 文件' };
  const empty = { testFiles: [], srcFiles: [], estTestFns: 0, srcLines: 0, bigTestFiles: [] };
  const h3 = D.scoreHealth(empty, false, emptyBasis);
  assert.strictEqual(h3.emptyScan, true);
  assert.strictEqual(h3.score, 0, '基线为空时健康分必须为 0（早期版本给 10 分）');
  assert.ok(h3.warnings.some(w => w.startsWith('empty-scan')), '应有 empty-scan 警告');
  ok('scoreHealth 零测试压低分 / 良好项目高分 / no-test-fn / 基线为空不发分');
})();

// 4b. scanBasis -----------------------------------------------------------
(function checkBasis() {
  const b0 = D.scanBasis({ jsLikeFound: 3, oversizeSkipped: 0 });
  assert.strictEqual(b0.basisComplete, true);
  assert.strictEqual(b0.basisReason, null);
  assert.strictEqual(b0.jsLikeFound, 3);

  const b1 = D.scanBasis({ jsLikeFound: 0, oversizeSkipped: 0 });
  assert.strictEqual(b1.basisComplete, false, '零 JS/TS 文件时基线必须判为不可信');
  assert.ok(/JS\/TS/.test(b1.basisReason), '原因应说明只体检 JS/TS');
  ok('scanBasis 依 JS/TS 文件数判定扫描基线可信度');
})();

// 4c. parseNumberStrict ---------------------------------------------------
(function checkNumberStrict() {
  assert.strictEqual(D.parseNumberStrict('12'), 12);
  assert.strictEqual(D.parseNumberStrict('1.5'), 1.5);
  assert.strictEqual(D.parseNumberStrict(' 7 '), 7);
  // 早期用 parseInt/parseFloat：'12abc' 会被截成 12，'Infinity' 会变 Infinity
  for (const bad of ['abc', '12abc', '', 'Infinity', '-Infinity', 'NaN', '1,2', '0x10', '1e3', undefined, null]) {
    assert.ok(Number.isNaN(D.parseNumberStrict(bad)), '应判为 NaN: ' + JSON.stringify(bad));
  }
  ok('parseNumberStrict 拒绝 parseInt 会截断的脏值（12abc / Infinity / 0x10 / 1e3）');
})();

// 4d. parseArgs -----------------------------------------------------------
(function checkArgs() {
  const a = D.parseArgs(['doctor', '--root', 'x', '--min-tests', '5', '--json']);
  assert.strictEqual(a._[0], 'doctor');
  assert.strictEqual(a.root, 'x', '--root 应消费下一个 token，实际 ' + a.root);
  assert.strictEqual(a.minTests, 5);
  assert.strictEqual(a.json, true);

  const b = D.parseArgs(['--root=x', '--min-tests=3']);
  assert.strictEqual(b.root, 'x', '--root=x 内联形式');
  assert.strictEqual(b.minTests, 3, '--min-tests=3 内联形式');

  const c = D.parseArgs([]);
  assert.strictEqual(c._.length, 0);
  assert.strictEqual(c.root, process.cwd(), '未传 --root 时默认 cwd');

  const shouldThrow = [
    [['--bogus'], '未知长选项'],
    [['doctor', '--fail-on-issue'], '选项名拼错'],
    [['frobnicate'], '未知命令'],
    [['doctor', 'run'], '两个命令'],
    [['--root'], '--root 缺值'],
    [['--min-tests'], '--min-tests 缺值'],
    [['--json=1'], '--json 带值']
  ];
  for (const [argv, label] of shouldThrow) {
    let threw = null;
    try { D.parseArgs(argv); } catch (e) { threw = e; }
    assert.ok(threw instanceof D.UsageError, label + ' 应抛 UsageError，实际 ' + threw);
  }
  ok('parseArgs 严格消费取值 + 未知选项/命令/重复命令/缺值全部抛 UsageError');
})();

// 5. parseTestSummary -----------------------------------------------------
(function checkSummary() {
  const out = [
    '# Subtest: foo', 'ok 1 - foo',
    '# Subtest: bar', 'notOk 2 - bar',
    '# tests 2', '# pass 1', '# fail 1', '# skipped 0', '# todo 0', '# duration_ms 15.2'
  ].join('\n');
  const s = D.parseTestSummary(out);
  assert.strictEqual(s.tests, 2);
  assert.strictEqual(s.pass, 1);
  assert.strictEqual(s.fail, 1);
  assert.strictEqual(s.skipped, 0);
  assert.strictEqual(s.todo, 0);
  assert.strictEqual(s.durationMs, 15.2);
  assert.strictEqual(D.parseTestSummary('no summary here'), null);
  ok('parseTestSummary 解析 node --test 输出 + 无输出返回 null');
})();

// 6. CLI 端到端 -----------------------------------------------------------
(function checkCLI() {
  const zeroProj = makeProject({
    'package.json': JSON.stringify({ name: 'zt' }),
    'src/a.js': 'module.exports=1;\n'
  });
  const rc = (args) => {
    try { execFileSync(process.execPath, [CLI].concat(args), { stdio: 'pipe' }); return 0; }
    catch (e) { return e.status; }
  };

  assert.strictEqual(rc(['doctor', '--root', zeroProj, '--fail-on-issues']), 2, '零测试 + 门禁 应 exit 2');
  assert.strictEqual(rc(['doctor', '--root', zeroProj, '--min-tests', 'abc']), 2, '--min-tests 非整数 应 exit 2');
  assert.strictEqual(rc(['doctor', '--root', zeroProj, '--min-tests', '1.5']), 2, '--min-tests 小数 应 exit 2');
  assert.strictEqual(rc(['doctor', '--root', zeroProj, '--min-tests', '12abc']), 2, '--min-tests 12abc 应 exit 2');
  assert.strictEqual(rc(['doctor', '--root', zeroProj, '--bogus']), 2, '未知选项 应 exit 2');
  assert.strictEqual(rc(['doctor', '--root']), 2, '--root 缺值 应 exit 2');
  assert.strictEqual(rc(['nonsense']), 2, '未知命令 应 exit 2');
  assert.strictEqual(rc(['doctor', '--root', '/no/such/dir/xyz']), 2, '无效 root 应 exit 2');

  const goodProj = makeProject({
    'package.json': JSON.stringify({ name: 'gp', nyc: {} }),
    'src/a.js': 'module.exports=1;\n',
    'test/a.test.js': "const assert=require('assert');\ntest('x',()=>assert.ok(true));\n"
  });
  assert.strictEqual(rc(['doctor', '--root', goodProj]), 0, '良好项目 doctor 应 exit 0');
  assert.strictEqual(rc(['--help']), 0, '--help 应 exit 0');

  // 扫描基线为空：裸 doctor 也必须退 2（早期版本 rc=0 且报「门禁: 通过」）
  const pyProj = makeProject({
    'pyproject.toml': '[project]\nname="p"\n',
    'app/core.py': 'def add(a,b):\n    return a+b\n'
  });
  assert.strictEqual(rc(['doctor', '--root', pyProj]), 2, '纯 Python 项目应 exit 2');
  assert.strictEqual(rc(['run', '--root', pyProj]), 2, 'run 模式纯 Python 项目应 exit 2');

  ok('CLI 端到端（零测试门禁 / 阈值校验 / 未知选项 / 缺值 / 无效 root / 基线为空）退出码正确');
})();

console.log('\ntestlite 单测：' + pass + ' 项全绿');
