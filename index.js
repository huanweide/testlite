#!/usr/bin/env node
'use strict';

/*
 * testlite — 零依赖单文件 Node CLI · 测试卫生体检中心
 *
 *   doctor  静态体检（默认）：识别测试框架 / 发现测试文件 / 估算测试密度 /
 *           零测试警告 / 超大测试文件 / 覆盖率工具配置 / 综合健康分 + CI 门禁
 *   run     可选增强：spawn `node --test`（Node 内置 test runner）真跑并解析
 *           tests/pass/fail/skipped/todo + 总耗时；失败静默降级，不崩。
 *
 * 设计铁律（继承 family 方法沉淀）：
 *   - 纯本地、零依赖、离线、单文件，跨平台（Windows posix 路径）。
 *   - 门禁阈值一律 Number.isFinite 校验，非整数直接 exit 2，绝不静默放行。
 *   - root 必须 statSync 先验存在且为目录，错误路径不谎报"通过"。
 *   - 大文件（>5MB）跳过，避免 OOM；坏 JSON 静默跳过不崩。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB 上限，跳过防 OOM
const BIG_TEST_LINES = 600;             // 测试文件行数超过即判"过大"
const BIG_TEST_BYTES = 60 * 1024;       // 或体积超过 60KB

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function fileSize(p) {
  try { return fs.statSync(p).size; } catch (_) { return 0; }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

function countLines(text) {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

// ---------------------------------------------------------------------------
// 测试发现 / 框架识别
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  'coverage', '.nyc_output', '.next', '.nuxt', '.svelte-kit', '.cache',
  '.tmp', 'tmp', 'vendor', 'bower_components'
]);

const SRC_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']);
const TEST_NAME_RE = /(^|[._-])(test|spec)([._-]|$)/i; // foo.test.js / bar_spec.ts / test_foo.js
const TEST_FN_RE = /\b(?:test|it)\s*\(/g;       // test( / it(
const DENO_TEST_RE = /\bDeno\.test\s*\(/g;      // Deno.test(

function classifyFramework(root, pkg) {
  const dev = (pkg && pkg.devDependencies) || {};
  const deps = (pkg && pkg.dependencies) || {};
  const all = Object.assign({}, dev, deps);
  const configNamed = (name) =>
    all[name] ||
    isFile(path.join(root, name + '.config.js')) ||
    isFile(path.join(root, name + '.config.ts')) ||
    isFile(path.join(root, '.' + name + 'rc'));
  if (configNamed('vitest')) return 'vitest';
  if (configNamed('jest')) return 'jest';
  if (configNamed('mocha')) return 'mocha';
  if (configNamed('ava')) return 'ava';
  if (configNamed('jasmine')) return 'jasmine';
  if (all['@playwright/test'] || all['playwright']) return 'playwright';
  if (all['cypress']) return 'cypress';
  const scripts = (pkg && pkg.scripts) || {};
  const t = (scripts.test || '').toLowerCase();
  // 从 scripts.test 命令名识别框架（覆盖 devDeps 未显式声明的情况）
  if (/\bjest\b/.test(t)) return 'jest';
  if (/\bvitest\b/.test(t)) return 'vitest';
  if (/\bmocha\b/.test(t)) return 'mocha';
  if (/\bava\b/.test(t)) return 'ava';
  if (/\bpytest\b|\bunittest\b|\bpython -m test\b/.test(t)) return 'pytest';
  if (t.includes('node --test') || t.includes('node-test')) return 'node:test';
  if (t) return 'npm-test';
  return null;
}

function coverageConfigured(root, pkg) {
  if (!pkg) return false;
  if (pkg.nyc) return true;
  if (pkg.c8) return true;
  if (pkg.jest && typeof pkg.jest === 'object' && pkg.jest.collectCoverage) return true;
  for (const f of ['.nycrc', '.nycrc.json', '.nycrc.yml', 'c8.json']) {
    if (isFile(path.join(root, f))) return true;
  }
  return false;
}

function discoverTests(root) {
  const testFiles = [];
  const srcFiles = [];
  const bigTestFiles = [];
  let estTestFns = 0;
  let srcLines = 0;

  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!SRC_EXT.has(ext)) continue;
      const bytes = fileSize(full);
      if (bytes > MAX_FILE_BYTES) continue;
      let text = '';
      try { text = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }

      const inTestsDir = /(^|[\\/])(__tests__|test|tests|spec)([\\/])/i.test(full);
      const isTestByName = TEST_NAME_RE.test(e.name);
      const isTest = inTestsDir || isTestByName;

      if (isTest) {
        testFiles.push(full);
        const fns = (text.match(TEST_FN_RE) || []).length + (text.match(DENO_TEST_RE) || []).length;
        estTestFns += fns;
        const lines = countLines(text);
        if (lines > BIG_TEST_LINES || bytes > BIG_TEST_BYTES) {
          bigTestFiles.push({ path: full, lines, bytes });
        }
      } else {
        srcFiles.push(full);
        srcLines += countLines(text);
      }
    }
  }

  return { testFiles, srcFiles, estTestFns, srcLines, bigTestFiles };
}

// ---------------------------------------------------------------------------
// 健康分
// ---------------------------------------------------------------------------

function scoreHealth(d, coverage) {
  const warnings = [];
  const zeroTest = d.srcFiles.length > 0 && d.testFiles.length === 0;
  const density = d.srcLines > 0 ? d.estTestFns / (d.srcLines / 1000) : 0;

  let score = 0;
  if (d.testFiles.length > 0) score += 40;
  score += Math.min(30, density * 8);
  if (coverage) score += 10;
  if (d.bigTestFiles.length === 0) score += 10;
  else score -= Math.min(20, d.bigTestFiles.length * 10);
  if (zeroTest) score = Math.min(score, 20);
  score = Math.max(0, Math.min(100, Math.round(score)));

  if (zeroTest) warnings.push('zero-test: 项目有源码但零测试文件，测试卫生为 0');
  if (d.bigTestFiles.length > 0) {
    for (const b of d.bigTestFiles) {
      warnings.push('big-test: 测试文件过大 ' + b.path + ' (' + b.lines + ' 行)');
    }
  }
  if (!zeroTest && d.testFiles.length > 0) {
    if (d.estTestFns === 0) {
      warnings.push('no-test-fn: 测试文件存在但未检出 test()/it() 风格（可能是 assert 块或自定义 runner），密度无法精确估算');
    } else if (density < 1) {
      warnings.push('low-density: 测试密度偏低 (' + density.toFixed(2) + ' 测试函数/千行源码)');
    }
  }
  if (d.testFiles.length > 0 && !coverage) {
    warnings.push('no-coverage: 未检测到覆盖率工具配置');
  }

  return { score, warnings, density, zeroTest };
}

// ---------------------------------------------------------------------------
// run 模式：解析 node --test 输出
// ---------------------------------------------------------------------------

function parseTestSummary(text) {
  if (!text) return null;
  const get = (label) => {
    const m = text.match(new RegExp('#\\s*' + label + '\\s+(\\d+)', 'm'));
    return m ? parseInt(m[1], 10) : null;
  };
  const duration = (() => {
    const m = text.match(/#\s*duration_ms\s+([\d.]+)/m);
    return m ? parseFloat(m[1]) : null;
  })();
  const tests = get('tests');
  const pass = get('pass');
  const fail = get('fail');
  const skipped = get('skipped');
  const todo = get('todo');
  if (tests === null && pass === null && fail === null) return null;
  return { tests, pass, fail, skipped, todo, durationMs: duration };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [], root: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'doctor' || a === 'run') args._.push(a);
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--min-tests') args.minTests = parseInt(argv[++i], 10);
    else if (a === '--min-density') args.minDensity = parseFloat(argv[++i]);
    else if (a === '--fail-on-issues') args.failOnIssues = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log([
    'testlite — 零依赖单文件测试卫生体检 CLI',
    '',
    '用法:',
    '  testlite doctor [--root <dir>] [--json] [--min-tests <n>] [--min-density <n>] [--fail-on-issues]',
    '  testlite run    [--root <dir>] [--json]    # 可选：用 node --test 真跑并解析',
    '',
    '  doctor  静态体检（默认）：测试框架识别 / 测试发现 / 密度估算 / 零测试警告 /',
    '          超大测试文件 / 覆盖率配置 / 健康分 + CI 门禁',
    '  run     用 Node 内置 test runner 真跑，解析 pass/fail/skip/todo + 总耗时（失败降级）',
    '',
    '门禁（非整数阈值直接 exit 2）：',
    '  --min-tests <n>      估算测试函数数低于 n 则失败',
    '  --min-density <n>    测试密度（测试函数/千行源码）低于 n 则失败',
    '  --fail-on-issues     存在体检警告（零测试/超大文件/低密度/无覆盖率）则失败',
  ].join('\n'));
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { printHelp(); return 0; }

  const cmd = args._[0] || 'doctor';
  const root = path.resolve(args.root);

  if (!isDir(root)) {
    console.error('[testlite] 错误：root 不是有效目录 -> ' + root);
    return 2;
  }

  const pkg = readJsonSafe(path.join(root, 'package.json'));
  const d = discoverTests(root);
  const framework = classifyFramework(root, pkg);
  const cov = coverageConfigured(root, pkg);
  const health = scoreHealth(d, cov);

  if (cmd === 'run') {
    const r = spawnSync(process.execPath, ['--test', root], {
      cwd: root, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024
    });
    const out = (r.stdout || '') + (r.stderr || '');
    const summary = parseTestSummary(out);
    const ran = !!(summary && summary.tests > 0);
    const report = {
      mode: 'run',
      root,
      framework: framework || '未知',
      ran,
      summary: summary || { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, durationMs: null },
      static: {
        testFiles: d.testFiles.length, estTestFns: d.estTestFns,
        srcLines: d.srcLines, healthScore: health.score, warnings: health.warnings
      }
    };
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('testlite run · root=' + root);
      console.log('  框架: ' + (framework || '未知'));
      if (ran) {
        const s = summary;
        console.log('  汇总: tests=' + s.tests + ' pass=' + s.pass + ' fail=' + s.fail +
          ' skipped=' + s.skipped + ' todo=' + s.todo +
          ' duration_ms=' + (s.durationMs != null ? s.durationMs.toFixed(1) : 'n/a'));
      } else {
        console.log('  未能用 node --test 解析到测试（项目可能使用 jest/vitest 等，请用其自带 runner；testlite run 默认仅支持 Node 内置 test runner）。已降级为静态体检。');
      }
      console.log('  静态体检: 测试文件=' + d.testFiles.length + ' 估算测试函数=' + d.estTestFns + ' 健康分=' + health.score);
      for (const w of health.warnings) console.log('  [警告] ' + w);
    }
    if (ran && summary.fail > 0) {
      console.error('[testlite] 门禁失败：存在 ' + summary.fail + ' 个失败测试');
      return 2;
    }
    return 0;
  }

  // doctor（默认）
  const report = {
    mode: 'doctor',
    root,
    framework: framework || '未知',
    coverageConfigured: cov,
    testFiles: d.testFiles.length,
    srcFiles: d.srcFiles.length,
    estTestFns: d.estTestFns,
    srcLines: d.srcLines,
    density: Number(health.density.toFixed(2)),
    bigTestFiles: d.bigTestFiles.map(b => ({ path: b.path, lines: b.lines })),
    healthScore: health.score,
    warnings: health.warnings
  };

  const gate = [];
  if (args.minTests !== undefined) {
    if (!Number.isFinite(args.minTests)) { console.error('[testlite] 错误：--min-tests 必须为整数'); return 2; }
    if (d.estTestFns < args.minTests) gate.push('估算测试函数数 ' + d.estTestFns + ' < --min-tests ' + args.minTests);
  }
  if (args.minDensity !== undefined) {
    if (!Number.isFinite(args.minDensity)) { console.error('[testlite] 错误：--min-density 必须为数字'); return 2; }
    if (health.density < args.minDensity) gate.push('测试密度 ' + health.density.toFixed(2) + ' < --min-density ' + args.minDensity);
  }
  if (args.failOnIssues && health.warnings.length > 0) {
    gate.push('存在 ' + health.warnings.length + ' 条体检警告');
  }

  if (args.json) {
    report.gate = { passed: gate.length === 0, failures: gate };
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('testlite · 测试卫生体检 · root=' + root);
    console.log('  测试框架     : ' + (framework || '未知'));
    console.log('  覆盖率配置   : ' + (cov ? '有' : '无'));
    console.log('  测试文件数   : ' + d.testFiles.length);
    console.log('  源码文件数   : ' + d.srcFiles.length);
    console.log('  估算测试函数 : ' + d.estTestFns);
    console.log('  源码总行数   : ' + d.srcLines);
    console.log('  测试密度     : ' + health.density.toFixed(2) + ' 函数/千行');
    if (d.bigTestFiles.length) {
      console.log('  超大测试文件 :');
      for (const b of d.bigTestFiles) console.log('    - ' + b.path + ' (' + b.lines + ' 行)');
    }
    console.log('  健康分       : ' + health.score + ' / 100');
    if (health.warnings.length) {
      console.log('  警告:');
      for (const w of health.warnings) console.log('    [警告] ' + w);
    } else {
      console.log('  警告: 无');
    }
    if (gate.length) {
      console.log('  门禁: 失败');
      for (const g of gate) console.log('    [失败] ' + g);
    } else {
      console.log('  门禁: 通过');
    }
  }

  return gate.length ? 2 : 0;
}

module.exports = {
  readJsonSafe, fileSize, isDir, isFile, countLines,
  classifyFramework, coverageConfigured, discoverTests, scoreHealth,
  parseTestSummary, MAX_FILE_BYTES
};

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error('[testlite] 运行异常: ' + (e && e.message));
    process.exit(1);
  }
}
