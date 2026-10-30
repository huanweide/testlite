**中文** · [README.md](./README.md)

<p align="center">
  <a href="https://github.com/huanweide/family-showcase"><img src="https://img.shields.io/badge/Engineering%20Health%20Family-18%20axes-22c55e" alt="Engineering Health Family"></a>
  <a href="https://github.com/huanweide/testlite/stargazers"><img src="https://img.shields.io/github/stars/huanweide/testlite" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/huanweide/testlite" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node"></a>
</p>

# testlite

> Zero-dependency, single-file Node CLI — a test-hygiene checkup center.

> [!WARNING]
> **This axis has been merged into the [doctors](https://github.com/huanweide/doctors) monorepo and is no longer maintained.**
> The code now lives at [`doctors/packages/testlite/`](https://github.com/huanweide/doctors/tree/main/packages/testlite) and runs as the `doctors test` subcommand (or `node packages/testlite/index.js`). This repository no longer accepts changes — please use <https://github.com/huanweide/doctors>.

**Part of the [Engineering Health Family](https://github.com/huanweide/family-showcase)** (18 zero-dependency checkup axes). Standalone tool — see [doctors](https://github.com/huanweide/doctors) (monorepo) and [enghealth](https://github.com/huanweide/enghealth) (unified runner).

## Why testlite

`devdoctor` checks whether your dependencies are clean; `testlite` checks whether your tests are healthy. Together they complete the story for the code-health tool series.

Existing test statistics (`jest --coverage` / `istanbul` / `c8`) either require dependencies or heavy configuration. A bare `npm test` only runs — it does not check hygiene, and bolt a "test-hygiene gate" onto CI means writing a pile of scripts. `testlite` is zero-dependency, single-file, runs out of the box, and gives you one-click test hygiene plus a CI-ready gate.

## Read this before installing

`testlite` is **not published to npm** — the `testlite` package on npm belongs to someone else (bdsomer's testing helper). Running `npm i -g testlite` or `npx testlite` installs the wrong package and hijacks the command name. So:

```bash
# Recommended: clone and run (zero dependencies, no npm install)
git clone https://github.com/huanweide/testlite.git
node testlite/index.js doctor --root <your-project>

# Or run directly from GitHub source via npx (bypasses the npm registry, no name clash)
npx github:huanweide/testlite doctor --root <your-project>
```

## Who should use this

- You maintain a JS/TS project and want a quick, dependency-free read on whether your tests are healthy.
- You want a CI gate that fails the build on zero tests, oversized test files, or missing coverage config.

## Who should NOT use this

- You need line/branch coverage percentages — `testlite` estimates density, it does not compute coverage. Use `c8` / `jest --coverage` for that.
- You are looking for the actively maintained version — use [`doctors test`](https://github.com/huanweide/doctors) instead.

## Usage

```bash
# Static checkup (default)
testlite doctor [--root <dir>] [--json] [--min-tests <n>] [--min-density <n>] [--fail-on-issues]

# Optional: actually run with the Node built-in test runner and parse results
testlite run    [--root <dir>] [--json] [--min-tests <n>] [--min-density <n>] [--fail-on-issues]
```

The `--root=<dir>` inline form is also accepted.

`doctor` (static) covers:

- Test framework detection (vitest / jest / mocha / ava / playwright / cypress / node:test / npm-test)
- Test discovery (multiple naming conventions: `*.test.js` / `*.spec.ts` / `test_foo.js` / `__tests__` / `test|tests|spec` directories)
- Test density estimate (test functions per 1k lines of source)
- Zero-test warning (source exists but no test files)
- Oversized test file warning (lines > 600 or size > 60 KB)
- Coverage tool config detection (nyc / c8 / jest.collectCoverage / .nycrc)
- Composite health score (0–100)

`run` optional enhancement: spawns `node --test`, parses tests/pass/fail/skipped/todo + total time; if the project uses jest/vitest and parsing fails, it automatically falls back to the static checkup instead of crashing.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Checkup passed |
| 1 | Internal error |
| 2 | Argument error / invalid root / gate not met |

Unknown options, missing values, and non-numeric thresholds all exit 2 — never silently passing:

```bash
$ testlite doctor --bogus           # rc=2, reports "unknown option: --bogus"
$ testlite doctor --min-tests 12abc # rc=2 (not truncated to 12)
$ testlite doctor --root            # rc=2 (missing value, no crash)
```

## CI gate

```bash
# Fewer than 10 test functions, or any checkup warning (zero tests / oversized / low density / no coverage) -> exit 2
testlite doctor --min-tests 10 --fail-on-issues
```

`run` honors all the same gate flags as `doctor` (an earlier version silently ignored them for `run`, making the gate meaningless).

### "Gate not enabled" is not "Gate passed"

When no threshold is passed, the tool applies **no gate at all** and the exit code is always 0. An earlier version still printed "gate: passed" in this case, misleading users into thinking CI would block problems (in practice: a zero-test project scoring 10/100 still showed "passed").

Now it distinguishes clearly:

```
$ testlite doctor --root .        # no threshold passed
  gate: not enabled (no threshold passed; exit code is always 0; add --min-tests / --min-density / --fail-on-issues to actually block)

$ testlite doctor --root . --min-tests 1
  gate: passed
```

In `--json`, the corresponding fields are `gate.active` / `gate.configured` / `gate.passed`: `configured` indicates whether the user actually set a threshold, and `passed` only means something when `active=true`.

## Scan baseline credibility (basisComplete)

The worst failure mode for a checkup tool is "scanned 0 objects but reported passed." `testlite` only checks JS/TS projects; if the given root contains **not a single JS/TS file** (e.g. you accidentally passed a Python project directory, or an empty directory), the old version computed "health 10/100 · no warnings · gate passed" from 0/0 and exited 0.

Now, in that situation:

- The health score shows `n/a (scan baseline empty, no score issued)`; in JSON `healthScore: 0`
- Both the report and JSON carry `basisComplete: false` and `basisReason`
- The gate fails unconditionally (rc=2), whether or not a threshold was explicitly passed

If you chain multiple gate tools downstream, use `basisComplete` to decide whether this conclusion is trustworthy.

## Differentiation

| Tool | Zero-dep | Single-file | Test hygiene checkup | CI gate |
|------|----------|-------------|----------------------|---------|
| jest --coverage | No | No | Coverage only | Needs config |
| c8 / istanbul | No | No | Coverage | Needs config |
| leasot | No | No | TODO scan | Needs install |
| **testlite** | **Yes** | **Yes** | **Yes (density / zero-test / oversized / coverage)** | **Yes (built-in)** |

## Design principles

- Pure local, zero-dependency, offline, single-file, cross-platform (Windows posix paths).
- Unknown option / missing value / non-numeric threshold always exits 2, never silently passing.
- Thresholds accept only whole numbers: `12abc`, `1e3`, `0x10`, `Infinity` are all rejected (`parseInt` would silently truncate or coerce them).
- **An empty scan baseline must error**, never "zero objects = passed"; conclusions carry `basisComplete` for downstream trust.
- Test-directory detection only looks at **relative** path segments under root — a root path containing `test/` must not misclassify the whole source tree as tests.
- root must be `statSync`-verified to exist and be a directory; a wrong path never falsely reports "passed".
- The entrypoint uses `process.exitCode` instead of `process.exit()`: the latter truncates stdout that has not flushed, breaking `--json` in a pipe (`JSON.parse` would explode).
- Large files (>5 MB) are skipped to prevent OOM; bad JSON is silently skipped without crashing.

## Requirements

Node.js >= 18. The `run` subcommand relies on the Node built-in test runner (`node --test`); earlier versions cannot actually execute.

## Tests and gate

```bash
npm test                # unit tests + entrypoint smoke, both must be green
node test.js            # unit tests (10 groups)
node test/smoke-cli.js  # entrypoint smoke (spawn-level, 9 groups, verifies real exit codes)
```

CI runs the full matrix on Node 18/20/22 × ubuntu/windows, plus a zero-dependency self-proof, README consistency check, and dogfood self-check.

> Why spawn-level smoke on top of unit tests: `node test.js` only tests exported functions and **never touches `process.exit`**. The entire value of the gate is in the exit code — a wrong exit code means green unit tests are useless. This gate is verified by 10 mutation tests (each injects a defect and confirms it is caught); a gate without mutation verification is no gate.

## License

MIT

---

Maintained by **huanweide** · [GitHub](https://github.com/huanweide)

← [Back to the code-health family overview](https://github.com/huanweide/family-showcase)
