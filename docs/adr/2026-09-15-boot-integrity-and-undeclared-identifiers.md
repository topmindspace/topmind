# ADR 2026-09-15 — Boot integrity, undeclared identifiers, and testing that code runs

Status: accepted
Supersedes: none
Related: `2026-09-15-cross-platform-chrome-and-suggest-lifecycle.md`, `2026-08-27-desktop-log-rotation.md`

## Context

v4.2.0 shipped. All five surfaces reported 4.2.0, `desktop:quality` was green end
to end (486 root / 41 skills / 140 utr / 1137 desktop tests, `tsc --noEmit` clean,
`check:electron` clean, `pack:verify` 12/12), and the app could not open a window
on any platform. A user on Windows saw:

```
topmind failed to start
popupSink is not defined
ReferenceError: popupSink is not defined
  at setMenuPopupSink (…/app.asar/electron/lib/app-menu.mjs:13)
  at wireApplicationMenu (…/app.asar/electron/main.mjs:819)
```

The same commit also carried a second, older defect: `scripts/install-skills.mjs`
had been syntactically invalid since the initial commit, so `npm run
skills:install`, `skills:update` and `skills:list` had never once run.

Both were invisible to a suite that was, by its own accounting, complete.

## Decisions

### D1 — `popupSink` was never declared; the fix is a declaration, the lesson is a guard

`setMenuPopupSink(sink)` assigned to `popupSink`, a name that appears nowhere
else as a binding. `popupOpenId`, its sibling in the same block, was declared
three lines up — the omission was in the declaration, not the logic.

ESM is always strict mode, so this is never a silent global. It is a
`ReferenceError` at the moment of assignment, and the assignment happens inside
the ready handler during menu wiring — before the first window. The failure mode
is therefore "no window", not "a broken menu".

The declaration is added. What matters more is why nothing caught it:

- **`node --check` parses, it does not evaluate.** `check:electron` runs it.
  Assigning to an undeclared name is *valid syntax*; the failure is a runtime
  ReferenceError, which no parser is looking for.
- **`tsc --noEmit` never reads `.mjs`.** The main process is plain JS by design —
  Electron loads it directly — so the one tier in this repo that does name
  resolution does not apply to the one tier that has no types.
- **The existing test asserted on text.** `app-menu.test.mjs` verified that the
  string `export function setMenuPopupSink` was present. A function that cannot
  be called satisfied its own test.

### D2 — A `hasGlobal` trap made the first version of the new check pass the very bug it was written for

The first `check-undeclared-idents.mjs` reported 0 problems — on the exact source
that could not boot. The cause: it asked `path.scope.hasGlobal(name)`.

Babel models **sloppy-mode implicit globals**: an assignment to an undeclared
name *registers that name as a global*, so `hasGlobal` returns `true` for it.
The check was answered by the very thing it was trying to detect.

The fix is to walk the binding tables instead — `hasOwnBinding` up the scope
chain — which asks the question actually intended: "was this ever declared?" The
check is verified against a deliberately re-broken tree, not just against a
clean one. This is recorded because the next person to write a static check will
reach for the same API for the same reason.

### D3 — `check-undeclared-idents.mjs` joins the quality gate

Scans every `.mjs`/`.js` module under both the desktop app and the repo root
(448 modules, ~1 s) and fails on any bare identifier that is assigned or
incremented without a binding in scope and outside a short host-globals list.

Scope analysis is the point: in `app-menu.mjs`, `popupOpenId` (declared, fine)
and `popupSink` (not declared, fatal) sit four lines apart. A regex cannot tell
them apart; a parser can.

Reads are reported separately, behind `--all`, and never affect the exit code —
the host injects names that cannot be enumerated, and an advisory list that
blocks the gate would be deleted within a week. Only the assignment tier decides
pass/fail.

Wired into `desktop:validate` after `check:electron`, so CI covers it and every
host that runs `npm run validate` inherits it.

### D4 — The main process is now actually booted under test

`tests/electron-module-load.test.mjs` imports all 109 main-process modules for
real under Node with `electron` replaced by an inert stub, then **drains the
ready handler** so the boot sequence runs: branding, menu install, engine
resolution, window creation, global shortcuts, tray.

Two details make it work, and both were arrived at by watching it fail:

- **The stub is a real module, not a string in the loader.** Code inside a
  template literal is invisible to the type checker, the dead-code scan and
  D3's new check — shipping an uncheckable stub would re-create the class of
  problem being fixed.
- **A boot failure is not an exception.** `showBootError` logs and opens a native
  error box; the process still exits 0. So the stub *records* `showErrorBox`
  calls and the helper fails on them. Without this, the check would report
  success on a tree that cannot start — which is precisely the shape of the
  4.2.0 escape.

`registerHooks` (synchronous) rather than `register` (worker) is used to
intercept the specifier, because most of this codebase reaches Electron through
`createRequire`, which the async worker never sees.

### D5 — `install-skills.mjs` is repaired, and repo scripts are now covered

The `--skill` branch was missing its closing brace, so the `else if` chain
followed a `for` block directly. `node --check` fails on it in 20 ms. Nothing ran
it: `check:electron` only walks `electron/`, and the root scripts had no syntax
gate at all. D3's scanner covers them now — a file that cannot be parsed is
reported as a hole in the scan rather than silently skipped.

## The shared failure mode

Both defects share one property, and it is worth stating plainly because it will
recur: **the suite verified that code was written, not that it ran.**

- A test asserted a string was present in a file. The function that string
  defined was uncallable.
- Three npm scripts pointed at a file that no parser had ever successfully read.

The countermeasure is scheduled execution, not more assertions: parse every
module (D3), load every module, and drive the app to the point where it either
has a window or shows an error box (D4). The v4.2.1 build was verified by
launching the packaged app — boot, workspace activation, window creation, tray —
and by re-introducing the defect to confirm the new guard turns red.

## Consequences

- `npm run desktop:validate` gains one fast static check; CI inherits it.
- The desktop test suite gains two tests that spawn a child process; ~440 ms.
- A new Electron API used from a module will fail the stub-coverage test until
  the stub is extended. That is intentional: a missing export in the double is
  indistinguishable from a missing API in the product, and `nativeImage` was
  found exactly that way during this work.
- Repository scripts are now syntax-checked as a side effect of D3, which no
  previous gate did.
