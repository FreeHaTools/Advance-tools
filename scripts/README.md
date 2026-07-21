# Repository checks

`verify.py` is the pre-flight check suite for this add-on. Every check exists
because the corresponding bug has already shipped to users at least once. Run it
before you commit a release.

## Running it

Windows:

```
python scripts\verify.py
```

Linux / CI:

```
python scripts/verify.py
```

Flags:

| Flag        | Effect                                                          |
| ----------- | --------------------------------------------------------------- |
| `--quick`   | Skip the boot smoke test (check 10) — fast, good for a pre-commit loop |
| `--verbose` | Print per-file detail for every check                           |

Exit code is `1` if anything FAILs, `0` otherwise. WARNings never fail the build.

`verify.py` is stdlib-only, so it runs against a bare Python 3 install. Two
optional extras upgrade it when present: `aiohttp` (required for the boot smoke
test — the check SKIPs without it) and Node.js (for `node --check`; that check
SKIPs without it). PyYAML, if installed, upgrades the YAML check from a
structural scan to a real parse.

## What each check protects against

| # | Check | Real incident it guards |
| - | ----- | ----------------------- |
| 1 | Python syntax | A `.py` file was silently truncated on disk and shipped unparseable. |
| 2 | JSON validity | A truncated `manifest.json` made the tool loader skip a whole tool. |
| 3 | YAML sanity | A malformed `config.yaml` stopped the Supervisor from reading the add-on. |
| 4 | JavaScript syntax | A half-written `.js` file broke a page with no server-side error. |
| 5 | Truncation heuristics | HTML files cut off mid-document — the page rendered blank below the fold. |
| 6 | Encoding integrity | A file rewritten with a non-UTF-8 encoding turned every emoji into `???`. |
| 7 | Version consistency | `config.yaml` said one version, `main.py` `VERSION` said another, so the update never took. |
| 8 | Tool manifests | A tool's `static/` folder was never committed, so its page 404'd in production. |
| 9 | Untracked-file guard | Same incident as above, caught one layer earlier — nothing under `advance_tools/` may be untracked. |
| 10 | Boot smoke test | A release that crashed on startup, and one where a tool page returned 500. |

Note on check 6: the rule is deliberately narrow — it fails only when `???`
appears on a line that *also* contains a UI marker (`<button`, `<h1`..`<h3`,
`title=`, `data-nav=`), since that is what the real mangling looked like. Widen
or narrow it by editing `EMOJI_CONTEXT_MARKERS` at the top of `verify.py`.

Note on check 8: a missing local `static/` folder is only an error when
`tool.py` actually references one. Tools such as `dashboard_maker` legitimately
serve the shared `app/static/` folder instead, and are not flagged.

## Adding a new check

1. Write a `check_something(res: Results) -> None` function in `verify.py`.
2. Report exactly one outcome per check with `res.add(PASS | FAIL | WARN | SKIP,
   "Check name", "message")`. The message must name the offending file path.
   Use `rel(path)` so output is identical on Windows and Linux.
3. Use `res.detail("...")` for per-file noise — it only prints under `--verbose`.
4. Prefer `WARN` over `FAIL` for heuristics that can produce false positives;
   only fail the build on something you are certain is broken.
5. Call it from `main()`, in the same order it appears in the docstring.
6. Verify it both ways: confirm it PASSes on a clean tree, then deliberately
   introduce the bug in a scratch copy of the repo and confirm it FAILs. A check
   that has never caught anything is not a check.

Keep everything — code, comments and output strings — in English, and stdlib
only. `aiohttp` may be imported, but only inside the boot smoke test.
