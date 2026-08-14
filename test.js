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
  ok('discoverTests 真实计数（测试/源码/函数/行/超大）正确');
})();

// 4. scoreHealth ----------------------------------------------------------
(function checkScore() {
  const zero = { testFiles: [], srcFiles: ['a.js'], estTestFns: 0, srcLines: 10, bigTestFiles: [] };
  const h0 = D.scoreHealth(zero, false);
  assert.strictEqual(h0.zeroTest, true);
  assert.ok(h0.warnings.some(w => w.startsWith('zero-test')));
  assert.ok(h0.score <= 20, '零测试应压低健康分，实际 ' + h0.score);

  const good = { testFiles: ['t.js'], srcFiles: ['s.js'], estTestFns: 20, srcLines: 1000, bigTestFiles: [] };
  const h1 = D.scoreHealth(good, true);
  assert.strictEqual(h1.zeroTest, false);
  assert.ok(h1.score >= 80, '良好项目健康分应高，实际 ' + h1.score);
  assert.ok(h1.density > 0);

  // 非 test()/it() 风格（assert 块）项目：应给 no-test-fn 而非 low-density
  const assertStyle = { testFiles: ['t.js'], srcFiles: ['s.js'], estTestFns: 0, srcLines: 100, bigTestFiles: [] };
  const h2 = D.scoreHealth(assertStyle, false);
  assert.ok(h2.warnings.some(w => w.startsWith('no-test-fn')), '应检出 no-test-fn 警告，实际 ' + JSON.stringify(h2.warnings));
  assert.ok(!h2.warnings.some(w => w.startsWith('low-density')), '不应误报 low-density');
  ok('scoreHealth 零测试压低分 / 良好项目高分 / no-test-fn 警告正确');
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
  let status2 = -1;
  try { execFileSync(process.execPath, [CLI, 'doctor', '--root', zeroProj, '--fail-on-issues'], { stdio: 'pipe' }); }
  catch (e) { status2 = e.status; }
  assert.strictEqual(status2, 2, '零测试 + 门禁 应 exit 2');

  let statusNa = -1;
  try { execFileSync(process.execPath, [CLI, 'doctor', '--root', zeroProj, '--min-tests', 'abc'], { stdio: 'pipe' }); }
  catch (e) { statusNa = e.status; }
  assert.strictEqual(statusNa, 2, '--min-tests 非整数 应 exit 2');

  const goodProj = makeProject({
    'package.json': JSON.stringify({ name: 'gp', nyc: {} }),
    'src/a.js': 'module.exports=1;\n',
    'test/a.test.js': "const assert=require('assert');\ntest('x',()=>assert.ok(true));\n"
  });
  let status0 = 0;
  try { execFileSync(process.execPath, [CLI, 'doctor', '--root', goodProj], { stdio: 'pipe' }); }
  catch (e) { status0 = e.status; }
  assert.strictEqual(status0, 0, '良好项目 doctor 应 exit 0');

  let statusBad = -1;
  try { execFileSync(process.execPath, [CLI, 'doctor', '--root', '/no/such/dir/xyz'], { stdio: 'pipe' }); }
  catch (e) { statusBad = e.status; }
  assert.strictEqual(statusBad, 2, '无效 root 应 exit 2');

  ok('CLI 端到端（零测试门禁 / 非整数阈值 / 良好项目 / 无效 root）退出码正确');
})();

console.log('\ntestlite 单测：' + pass + ' 项全绿');
