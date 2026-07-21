#!/usr/bin/env python3
"""Advance Tools repository verifier.

A dependency-free (stdlib only) pre-flight check suite for this Home Assistant
add-on repository. It exists because every check below maps to a bug that has
actually shipped to users at least once:

  * files silently truncated on disk (half-written HTML / JS)
  * config.yaml version drifting away from VERSION in main.py
  * a tool whose static/ folder was never committed, so its page 404'd
  * emoji destroyed by writing files with a non-UTF-8 encoding ("???")

Usage
-----
    python scripts/verify.py            # everything, including the boot test
    python scripts/verify.py --quick    # skip the boot smoke test
    python scripts/verify.py --verbose  # per-file detail

Exit code is 1 if any check FAILs, 0 otherwise. WARNings never fail the build.

Runs on Windows and Linux: pathlib everywhere, sys.executable for subprocesses,
no shell invocations.
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

# --------------------------------------------------------------------------
# Repository layout
# --------------------------------------------------------------------------

REPO = Path(__file__).resolve().parent.parent
ADDON = REPO / "advance_tools"
APP_DIR = ADDON / "rootfs" / "app"
TOOLS_DIR = APP_DIR / "tools"
CONFIG_YAML = ADDON / "config.yaml"
REPO_YAML = REPO / "repository.yaml"
MAIN_PY = APP_DIR / "main.py"
CHANGELOG = ADDON / "CHANGELOG.md"

# Directories that never contain source we care about.
SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv",
             ".mypy_cache", ".pytest_cache", ".idea", ".vscode"}

# Extensions treated as text for the UTF-8 decode check.
TEXT_EXTS = {".py", ".js", ".html", ".htm", ".css", ".json", ".md", ".yaml",
             ".yml", ".txt", ".sh", ".cfg", ".ini", ".toml", ".svg"}

# Required keys in every tool manifest.json.
MANIFEST_KEYS = ("id", "name", "icon", "color", "description", "page", "version")

# --- Encoding rule (check 6) ----------------------------------------------
# The real incident: a file was rewritten with an ASCII-ish encoding and every
# emoji became "???". Those emoji live in UI chrome — button labels, headings,
# tooltips and nav entries — so a line containing BOTH "???" and one of these
# markers is almost certainly mangled text rather than a legitimate literal.
# Tune by editing this tuple; add markers as new UI patterns appear.
EMOJI_CONTEXT_MARKERS = ("<button", "<h1", "<h2", "<h3", "title=", "data-nav=")

# Mojibake signatures: UTF-8 bytes that were decoded as cp1252/latin-1 and
# saved again. The file stays valid UTF-8, so a plain decode check misses it,
# but the text renders as garbage ("â€”" for "—", "ðŸ " for an emoji).
MOJIBAKE_RE = re.compile(
    r'Ã[\x80-\xBF]'      # accented letters and most punctuation
    r'|â€'               # em dash, quotes, ellipsis
    r'|â†'               # arrows
    r'|ðŸ'               # emoji (4-byte sequences)
    r'|Â[\xA0-\xBF]'     # stray non-breaking space, degree, middle dot
    r'|â‚¬|Å"|â„¢'        # euro, oe ligature, trademark
)

# Minimum number of tool plugins the app must load at boot.
MIN_TOOLS = 10

# Boot smoke test timing.
BOOT_TIMEOUT = 40.0
# main.py binds this port unconditionally for the HA sidebar (ingress).
INGRESS_PORT = 8099

# --------------------------------------------------------------------------
# Result plumbing
# --------------------------------------------------------------------------

PASS, FAIL, WARN, SKIP = "PASS", "FAIL", "WARN", "SKIP"

_COLORS = {PASS: "\033[32m", FAIL: "\033[31m", WARN: "\033[33m", SKIP: "\033[36m"}
_RESET = "\033[0m"
_USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


class Results:
    """Collects check outcomes and prints them as they happen."""

    def __init__(self, verbose: bool = False) -> None:
        self.verbose = verbose
        self.rows: list[tuple[str, str, str]] = []

    def add(self, status: str, check: str, message: str = "") -> None:
        self.rows.append((status, check, message))
        tag = status
        if _USE_COLOR:
            tag = f"{_COLORS[status]}{status}{_RESET}"
        line = f"[{tag}] {check}"
        if message:
            line += f" — {message}"
        print(line)

    def detail(self, message: str) -> None:
        if self.verbose:
            print(f"       {message}")

    def count(self, status: str) -> int:
        return sum(1 for s, _, _ in self.rows if s == status)

    @property
    def failed(self) -> bool:
        return self.count(FAIL) > 0


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def walk_files(root: Path, suffix: str | None = None):
    """Yield every file under *root*, skipping noise directories."""
    for path in root.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if not path.is_file():
            continue
        if suffix and path.suffix.lower() != suffix:
            continue
        yield path


def rel(path: Path) -> str:
    """Repo-relative POSIX path, for stable output on Windows and Linux."""
    try:
        return path.resolve().relative_to(REPO).as_posix()
    except ValueError:
        return str(path)


def git(*args: str) -> tuple[int, str]:
    """Run a git command in the repo. Returns (returncode, stdout)."""
    exe = shutil.which("git")
    if not exe:
        return 127, ""
    try:
        proc = subprocess.run(
            [exe, *args], cwd=str(REPO), capture_output=True,
            text=True, encoding="utf-8", errors="replace", timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return 127, ""
    return proc.returncode, proc.stdout


def tracked_files() -> list[Path] | None:
    """Files tracked by git, or None when git is unavailable."""
    code, out = git("ls-files")
    if code != 0:
        return None
    return [REPO / line for line in out.splitlines() if line.strip()]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def tool_dirs() -> list[Path]:
    if not TOOLS_DIR.is_dir():
        return []
    return sorted(p for p in TOOLS_DIR.iterdir()
                  if p.is_dir() and p.name not in SKIP_DIRS)


# --------------------------------------------------------------------------
# 1. Python syntax
# --------------------------------------------------------------------------

def check_python_syntax(res: Results) -> None:
    """Every .py file must parse. Catches truncation and bad merges."""
    bad: list[str] = []
    count = 0
    for path in walk_files(REPO, ".py"):
        count += 1
        try:
            source = path.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            bad.append(f"{rel(path)}: not valid UTF-8 ({exc})")
            continue
        if not source.strip():
            bad.append(f"{rel(path)}: file is empty")
            continue
        try:
            ast.parse(source, filename=str(path))
        except SyntaxError as exc:
            bad.append(f"{rel(path)}:{exc.lineno}: {exc.msg}")
        else:
            res.detail(f"ok {rel(path)}")
    if bad:
        res.add(FAIL, f"Python syntax ({count} files)", "; ".join(bad))
    else:
        res.add(PASS, f"Python syntax ({count} files)")


# --------------------------------------------------------------------------
# 2. JSON validity
# --------------------------------------------------------------------------

def check_json(res: Results) -> None:
    """Every .json file must parse. Truncated manifests break the tool loader."""
    bad: list[str] = []
    count = 0
    for path in walk_files(REPO, ".json"):
        count += 1
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except UnicodeDecodeError as exc:
            bad.append(f"{rel(path)}: not valid UTF-8 ({exc})")
        except json.JSONDecodeError as exc:
            bad.append(f"{rel(path)}:{exc.lineno}: {exc.msg}")
        else:
            res.detail(f"ok {rel(path)}")
    if bad:
        res.add(FAIL, f"JSON validity ({count} files)", "; ".join(bad))
    else:
        res.add(PASS, f"JSON validity ({count} files)")


# --------------------------------------------------------------------------
# 3. YAML sanity
# --------------------------------------------------------------------------

def check_yaml(res: Results) -> None:
    """Structural sanity for the two YAML files Home Assistant reads.

    PyYAML is not a dependency of this repo, so the baseline is a hand-rolled
    sanity check. When PyYAML happens to be installed we upgrade to a real parse.
    """
    problems: list[str] = []

    for path in (CONFIG_YAML, REPO_YAML):
        if not path.is_file():
            problems.append(f"{rel(path)}: missing")
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            problems.append(f"{rel(path)}: not valid UTF-8 ({exc})")
            continue
        if not text.strip():
            problems.append(f"{rel(path)}: file is empty")
            continue
        for num, line in enumerate(text.splitlines(), 1):
            if line.startswith("\t"):
                problems.append(f"{rel(path)}:{num}: line starts with a TAB "
                                "(YAML forbids tab indentation)")
        res.detail(f"ok {rel(path)}")

    if CONFIG_YAML.is_file():
        text = CONFIG_YAML.read_text(encoding="utf-8", errors="replace")
        if not re.search(r"^version:\s*\S+", text, re.MULTILINE):
            problems.append(f"{rel(CONFIG_YAML)}: no 'version:' line")

    # Optional real parse of every YAML file when PyYAML is available.
    parsed_with_pyyaml = False
    try:
        import yaml  # type: ignore
    except ImportError:
        pass
    else:
        parsed_with_pyyaml = True
        for path in list(walk_files(REPO, ".yaml")) + list(walk_files(REPO, ".yml")):
            try:
                yaml.safe_load(path.read_text(encoding="utf-8"))
            except Exception as exc:  # noqa: BLE001 - report any parser error
                problems.append(f"{rel(path)}: {exc}")

    label = "YAML sanity" + (" (PyYAML parse)" if parsed_with_pyyaml
                             else " (structural, PyYAML absent)")
    if problems:
        res.add(FAIL, label, "; ".join(problems))
    else:
        res.add(PASS, label)


# --------------------------------------------------------------------------
# 4. JavaScript syntax
# --------------------------------------------------------------------------

def check_js_syntax(res: Results) -> None:
    """`node --check` every .js file. SKIPs when Node is not installed."""
    node = shutil.which("node")
    js_files = list(walk_files(REPO, ".js"))
    if not js_files:
        res.add(PASS, "JavaScript syntax (0 files)")
        return
    if not node:
        res.add(SKIP, "JavaScript syntax",
                f"Node.js not found on PATH; {len(js_files)} .js file(s) unchecked")
        return
    bad: list[str] = []
    for path in js_files:
        proc = subprocess.run([node, "--check", str(path)], capture_output=True,
                              text=True, encoding="utf-8", errors="replace")
        if proc.returncode != 0:
            first = (proc.stderr or proc.stdout).strip().splitlines()
            bad.append(f"{rel(path)}: {first[0] if first else 'node --check failed'}")
        else:
            res.detail(f"ok {rel(path)}")
    if bad:
        res.add(FAIL, f"JavaScript syntax ({len(js_files)} files)", "; ".join(bad))
    else:
        res.add(PASS, f"JavaScript syntax ({len(js_files)} files)")


# --------------------------------------------------------------------------
# 5. Truncation heuristics
# --------------------------------------------------------------------------

_JS_TAIL_OK = (";", "}", ")", "*/")


def check_truncation(res: Results) -> None:
    """Detect half-written files.

    HTML must end in </html>, JS should end in a statement terminator, and no
    file may be zero bytes. Python/JSON truncation is already covered by the
    syntax and JSON checks.
    """
    failures: list[str] = []
    warnings: list[str] = []

    # HTML must close properly.
    html_count = 0
    for path in list(walk_files(REPO, ".html")) + list(walk_files(REPO, ".htm")):
        html_count += 1
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue  # reported by the encoding check
        tail = text.rstrip()
        if not tail:
            failures.append(f"{rel(path)}: file is empty")
        elif not tail.endswith("</html>"):
            failures.append(f"{rel(path)}: does not end with </html> "
                            f"(last 40 chars: {tail[-40:]!r}) — likely truncated")
        else:
            res.detail(f"ok {rel(path)}")

    # Python files must be non-empty (parsing is check 1).
    for path in walk_files(REPO, ".py"):
        if path.stat().st_size == 0:
            failures.append(f"{rel(path)}: 0 bytes")

    # JS tails are advisory only — a bare identifier tail is legal JS.
    for path in walk_files(REPO, ".js"):
        try:
            tail = path.read_text(encoding="utf-8").rstrip()
        except UnicodeDecodeError:
            continue
        if not tail:
            failures.append(f"{rel(path)}: file is empty")
        elif not tail.endswith(_JS_TAIL_OK):
            warnings.append(f"{rel(path)}: ends with {tail[-30:]!r} — "
                            "expected ';', '}', ')' or a closed comment")

    # No tracked file may be zero bytes.
    tracked = tracked_files()
    if tracked is None:
        warnings.append("git unavailable — zero-byte tracked-file scan skipped")
    else:
        for path in tracked:
            if path.is_file() and path.stat().st_size == 0:
                failures.append(f"{rel(path)}: tracked file is 0 bytes")

    label = f"Truncation heuristics ({html_count} HTML files)"
    if failures:
        res.add(FAIL, label, "; ".join(failures))
    elif warnings:
        res.add(WARN, label, "; ".join(warnings))
    else:
        res.add(PASS, label)


# --------------------------------------------------------------------------
# 6. Encoding integrity
# --------------------------------------------------------------------------

def check_encoding(res: Results) -> None:
    """UTF-8 decodability plus the emoji-mangling heuristic.

    See EMOJI_CONTEXT_MARKERS at the top of this file for the rule and how to
    tune it.
    """
    failures: list[str] = []
    checked = 0

    for path in walk_files(REPO):
        if path.suffix.lower() not in TEXT_EXTS:
            continue
        checked += 1
        try:
            raw = path.read_bytes()
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            failures.append(f"{rel(path)}: not valid UTF-8 — {exc}")
            continue
        res.detail(f"utf-8 ok {rel(path)}")

        # Mojibake: valid UTF-8, so the check above passes, but the text was
        # once decoded as cp1252/latin-1 and re-saved. It renders as garbage
        # like "â€”" instead of "—" or "ðŸ " instead of an emoji. This shipped
        # to users in the HA sidebar launcher before anyone noticed, hence the
        # dedicated check. Repair by re-encoding the line to cp1252 and
        # decoding it as UTF-8.
        # This file necessarily contains those byte sequences in MOJIBAKE_RE
        # itself, so it cannot check itself.
        if path.resolve() != Path(__file__).resolve():
            for num, line in enumerate(text.splitlines(), 1):
                if MOJIBAKE_RE.search(line):
                    failures.append(
                        f"{rel(path)}:{num}: mojibake — text decoded as cp1252 "
                        "and re-saved; see scripts/README.md for the repair")

        if "???" not in text:
            continue
        for num, line in enumerate(text.splitlines(), 1):
            if "???" not in line:
                continue
            lowered = line.lower()
            hit = next((m for m in EMOJI_CONTEXT_MARKERS if m in lowered), None)
            if hit:
                failures.append(
                    f"{rel(path)}:{num}: '???' next to {hit!r} — "
                    "emoji were probably destroyed by a non-UTF-8 write")

    if failures:
        res.add(FAIL, f"Encoding integrity ({checked} text files)",
                "; ".join(failures))
    else:
        res.add(PASS, f"Encoding integrity ({checked} text files)")


# --------------------------------------------------------------------------
# 7. Version consistency
# --------------------------------------------------------------------------

def read_config_version() -> str | None:
    if not CONFIG_YAML.is_file():
        return None
    match = re.search(r'^version:\s*["\']?([^"\'\s#]+)',
                      CONFIG_YAML.read_text(encoding="utf-8", errors="replace"),
                      re.MULTILINE)
    return match.group(1) if match else None


def read_main_version() -> str | None:
    if not MAIN_PY.is_file():
        return None
    match = re.search(r'^VERSION\s*=\s*["\']([^"\']+)["\']',
                      MAIN_PY.read_text(encoding="utf-8", errors="replace"),
                      re.MULTILINE)
    return match.group(1) if match else None


def check_versions(res: Results) -> None:
    """config.yaml, main.py VERSION and CHANGELOG.md must agree."""
    cfg = read_config_version()
    main = read_main_version()
    problems: list[str] = []

    if cfg is None:
        problems.append(f"{rel(CONFIG_YAML)}: could not read 'version:'")
    if main is None:
        problems.append(f"{rel(MAIN_PY)}: could not read 'VERSION = ...'")

    if cfg and main and cfg != main:
        problems.append(
            f"version mismatch: {rel(CONFIG_YAML)} says {cfg!r} but "
            f"{rel(MAIN_PY)} says VERSION = {main!r}")

    version = cfg or main
    if version:
        if not CHANGELOG.is_file():
            problems.append(f"{rel(CHANGELOG)}: missing")
        else:
            text = CHANGELOG.read_text(encoding="utf-8", errors="replace")
            pattern = r"^##\s+v?" + re.escape(version) + r"\b"
            if not re.search(pattern, text, re.MULTILINE):
                problems.append(
                    f"{rel(CHANGELOG)}: no '## {version}' heading for the "
                    "current version")

    if problems:
        res.add(FAIL, "Version consistency", "; ".join(problems))
    else:
        res.add(PASS, "Version consistency", f"{version} in config/main/CHANGELOG")


# --------------------------------------------------------------------------
# 8. Tool manifests
# --------------------------------------------------------------------------

def check_tool_manifests(res: Results) -> None:
    """Structural contract for every plugin in rootfs/app/tools/<id>/."""
    dirs = tool_dirs()
    if not dirs:
        res.add(FAIL, "Tool manifests", f"{rel(TOOLS_DIR)}: no tool directories found")
        return

    failures: list[str] = []
    warnings: list[str] = []
    valid = 0

    for tdir in dirs:
        manifest_path = tdir / "manifest.json"
        tool_py = tdir / "tool.py"
        if not manifest_path.is_file() and not tool_py.is_file():
            # Not a plugin directory at all (e.g. a shared package) — ignore.
            continue
        if not manifest_path.is_file():
            failures.append(f"{rel(tdir)}: manifest.json missing")
            continue
        if not tool_py.is_file():
            failures.append(f"{rel(tdir)}: tool.py missing")
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            failures.append(f"{rel(manifest_path)}: {exc}")
            continue
        if not isinstance(manifest, dict):
            failures.append(f"{rel(manifest_path)}: top level is not an object")
            continue

        missing = [k for k in MANIFEST_KEYS if k not in manifest]
        if missing:
            failures.append(f"{rel(manifest_path)}: missing key(s) {', '.join(missing)}")
        if manifest.get("id") != tdir.name:
            failures.append(
                f"{rel(manifest_path)}: id {manifest.get('id')!r} does not match "
                f"directory name {tdir.name!r}")

        source = tool_py.read_text(encoding="utf-8", errors="replace")
        if not re.search(r"^\s*def\s+register\s*\(", source, re.MULTILINE):
            failures.append(f"{rel(tool_py)}: no 'def register(' entry point")

        # Static-asset guard. Some tools legitimately serve the *core*
        # app/static/ folder (dashboard_maker does), so the absence of a local
        # static/ dir is only a problem when tool.py actually reaches for one.
        # We therefore extract every `... / "static" / "<name>"` reference in
        # tool.py and require those files to exist on disk — which is exactly
        # the shape of the incident where a tool's static/ was never committed.
        for name in set(re.findall(r'["\']static["\']\s*/\s*["\']([^"\']+)["\']',
                                   source)):
            if (tdir / "static" / name).is_file():
                continue
            if (APP_DIR / "static" / name).is_file():
                continue  # served from the shared core static folder
            failures.append(
                f"{rel(tool_py)}: references static/{name} but it exists "
                f"neither in {rel(tdir)}/static/ nor in {rel(APP_DIR)}/static/ "
                "(was it committed?)")

        page = str(manifest.get("page", ""))
        if page.rstrip("/") == f"/tools/{tdir.name}" and (tdir / "static").is_dir():
            index = tdir / "static" / "index.html"
            if not index.is_file() and "index.html" not in source:
                warnings.append(
                    f"{rel(tdir)}: has a static/ folder and page {page!r} but no "
                    "static/index.html")
        valid += 1
        res.detail(f"ok {rel(tdir)}")

    label = f"Tool manifests ({valid} plugins)"
    if failures:
        res.add(FAIL, label, "; ".join(failures + warnings))
    elif warnings:
        res.add(WARN, label, "; ".join(warnings))
    else:
        res.add(PASS, label)


# --------------------------------------------------------------------------
# 9. Untracked-file guard
# --------------------------------------------------------------------------

def check_untracked(res: Results) -> None:
    """Nothing inside advance_tools/ may be untracked.

    This is the exact shape of the incident where a new tool's static/ folder
    was never `git add`ed, so the released add-on served a 404 for that page.
    """
    code, out = git("ls-files", "--others", "--exclude-standard")
    if code != 0:
        res.add(SKIP, "Untracked-file guard", "git not available")
        return
    stray = [line.strip() for line in out.splitlines()
             if line.strip().startswith("advance_tools/")]
    if stray:
        res.add(FAIL, "Untracked-file guard",
                f"{len(stray)} untracked file(s) under advance_tools/: "
                + ", ".join(stray[:20])
                + (" …" if len(stray) > 20 else ""))
    else:
        res.add(PASS, "Untracked-file guard", "nothing untracked under advance_tools/")


# --------------------------------------------------------------------------
# 10. Boot smoke test
# --------------------------------------------------------------------------

def _http_status(url: str, timeout: float = 10.0, with_location: bool = False):
    """GET *url* without following redirects.

    Returns (status, body), or (status, body, location) when *with_location*.
    """

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(url, timeout=timeout) as resp:
            status, body, headers = resp.status, resp.read(), resp.headers
    except urllib.error.HTTPError as exc:
        status, body, headers = exc.code, exc.read(), exc.headers
    if with_location:
        return status, body, headers.get("Location", "")
    return status, body


def check_boot(res: Results) -> None:
    """Actually start the add-on and hit its routes.

    Runs main.py in dev mode (no SUPERVISOR_TOKEN) against a throwaway DATA_DIR
    and a free port, waits for the 'listening on' log line, then verifies
    /health, /, /admin and every tool page.
    """
    if not MAIN_PY.is_file():
        res.add(FAIL, "Boot smoke test", f"{rel(MAIN_PY)} not found")
        return

    probe = subprocess.run([sys.executable, "-c", "import aiohttp"],
                           capture_output=True, text=True)
    if probe.returncode != 0:
        res.add(SKIP, "Boot smoke test",
                "aiohttp is not installed (pip install aiohttp)")
        return

    if not port_is_free(INGRESS_PORT):
        res.add(WARN, "Boot smoke test",
                f"port {INGRESS_PORT} (ingress, hardcoded in main.py) is already "
                "in use — the add-on cannot bind it, skipping boot test")
        return

    port = free_port()
    data_dir = Path(tempfile.mkdtemp(prefix="advance_tools_verify_"))
    env = dict(os.environ)
    env.pop("SUPERVISOR_TOKEN", None)  # force dev mode: no HA connection
    env.update({
        "DATA_DIR": str(data_dir),
        "APP_DIR": str(APP_DIR),
        "PORT": str(port),
        "SSL": "false",
        "PYTHONUNBUFFERED": "1",
        "PYTHONIOENCODING": "utf-8",
    })

    log_lines: list[str] = []
    proc = None
    problems: list[str] = []
    warnings: list[str] = []

    try:
        proc = subprocess.Popen(
            [sys.executable, str(MAIN_PY)],
            cwd=str(APP_DIR), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", bufsize=1,
        )

        def pump() -> None:
            assert proc.stdout is not None
            for line in proc.stdout:
                log_lines.append(line.rstrip("\n"))

        reader = threading.Thread(target=pump, daemon=True)
        reader.start()

        listen_re = re.compile(r"listening on :(\d+).*?(\d+)\s+tool\(s\)")
        deadline = time.time() + BOOT_TIMEOUT
        tool_count = None
        while time.time() < deadline:
            for line in list(log_lines):
                match = listen_re.search(line)
                if match:
                    tool_count = int(match.group(2))
                    break
            if tool_count is not None:
                break
            if proc.poll() is not None:
                problems.append(f"process exited early with code {proc.returncode}")
                break
            time.sleep(0.25)

        if tool_count is None and not problems:
            problems.append(f"no 'listening on' log line within {BOOT_TIMEOUT:.0f}s")

        if tool_count is not None:
            res.detail(f"booted on port {port} with {tool_count} tool(s)")
            if tool_count < MIN_TOOLS:
                problems.append(f"only {tool_count} tool(s) loaded, expected "
                                f"at least {MIN_TOOLS}")

            base = f"http://127.0.0.1:{port}"

            # /health must be 200 and report ok.
            try:
                status, body = _http_status(base + "/health")
                if status != 200:
                    problems.append(f"GET /health -> {status}, expected 200")
                else:
                    payload = json.loads(body.decode("utf-8"))
                    if payload.get("ok") is not True:
                        problems.append(f"GET /health returned {payload!r}, "
                                        'expected {"ok": true}')
                    else:
                        res.detail("GET /health -> 200 ok")
            except (OSError, ValueError) as exc:
                problems.append(f"GET /health failed: {exc}")

            # "/" serves the login page (200). On a brand-new DATA_DIR the app
            # legitimately redirects to the setup wizard instead, so a 302 is
            # accepted only when its target actually renders.
            try:
                status, _, location = _http_status(base + "/", with_location=True)
                if status == 200:
                    res.detail("GET / -> 200")
                elif status == 302 and location:
                    target = location if location.startswith("http") else base + location
                    hop, _ = _http_status(target)[:2]
                    if hop == 200:
                        res.detail(f"GET / -> 302 -> {location} -> 200 "
                                   "(fresh-install setup wizard)")
                    else:
                        problems.append(f"GET / redirected to {location} "
                                        f"which returned {hop}, expected 200")
                else:
                    problems.append(f"GET / -> {status}, expected 200 "
                                    "(or a 302 to a page that renders)")
            except (OSError, ValueError) as exc:
                problems.append(f"GET / failed: {exc}")

            try:
                status, _ = _http_status(base + "/admin")
                if status not in (200, 302):
                    problems.append(f"GET /admin -> {status}, expected 200 or 302")
                else:
                    res.detail(f"GET /admin -> {status}")
            except OSError as exc:
                problems.append(f"GET /admin failed: {exc}")

            # Every tool page must answer (200) or redirect to login (302).
            for tdir in tool_dirs():
                manifest_path = tdir / "manifest.json"
                if not manifest_path.is_file():
                    continue
                try:
                    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, UnicodeDecodeError):
                    continue  # reported by the manifest check
                page = str(manifest.get("page") or "")
                if not page.startswith("/"):
                    continue
                try:
                    status, _ = _http_status(base + page)
                except OSError as exc:
                    problems.append(f"GET {page} failed: {exc}")
                    continue
                if status not in (200, 302):
                    problems.append(f"GET {page} -> {status}, expected 200 or 302")
                else:
                    res.detail(f"GET {page} -> {status}")

        # A clean boot never logs a traceback, even if the HTTP checks passed.
        joined = "\n".join(log_lines)
        if "Traceback" in joined:
            offenders = [ln for ln in log_lines if "Failed to load tool" in ln]
            problems.append("boot log contains a Traceback"
                            + (f" ({'; '.join(offenders)})" if offenders else ""))

    except Exception as exc:  # noqa: BLE001 - never let the harness itself crash
        problems.append(f"harness error: {exc!r}")
    finally:
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=10)
        shutil.rmtree(data_dir, ignore_errors=True)

    if problems:
        res.add(FAIL, "Boot smoke test", "; ".join(problems))
        print("       --- captured add-on log ---")
        for line in log_lines[-120:]:
            print(f"       | {line}")
        print("       --- end of log ---")
    elif warnings:
        res.add(WARN, "Boot smoke test", "; ".join(warnings))
    else:
        res.add(PASS, "Boot smoke test", f"booted on :{port}, all routes healthy")


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify the Advance Tools add-on repository.")
    parser.add_argument("--quick", action="store_true",
                        help="skip the boot smoke test (check 10)")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="print per-file detail for every check")
    args = parser.parse_args(argv)

    if not ADDON.is_dir():
        print(f"ERROR: {rel(ADDON)} not found — is {REPO} the repository root?")
        return 1

    print(f"Advance Tools verifier — repo: {REPO}")
    print(f"Python {sys.version.split()[0]} on {sys.platform}")
    print("-" * 72)

    res = Results(verbose=args.verbose)

    check_python_syntax(res)
    check_json(res)
    check_yaml(res)
    check_js_syntax(res)
    check_truncation(res)
    check_encoding(res)
    check_versions(res)
    check_tool_manifests(res)
    check_untracked(res)
    if args.quick:
        res.add(SKIP, "Boot smoke test", "--quick was given")
    else:
        check_boot(res)

    print("-" * 72)
    summary = (f"{res.count(PASS)} passed, {res.count(WARN)} warning, "
               f"{res.count(FAIL)} failed")
    if res.count(SKIP):
        summary += f", {res.count(SKIP)} skipped"
    print(summary)
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
