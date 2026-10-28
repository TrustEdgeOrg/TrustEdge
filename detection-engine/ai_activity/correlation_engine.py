"""Correlate AI-session activity into higher-level findings."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from ai_activity.catalog import (
    FINDING_CLOUD_CLI,
    FINDING_CONTAINER_DEPLOY,
    FINDING_MULTI_TOOL_BURST,
    FINDING_SECRETS_ACCESS,
    FINDING_SECRETS_GIT_PUSH,
    FINDING_SHELL_NETWORK_EXFIL,
    FINDING_TERMINAL_TOOL_CHAIN,
    MULTI_TOOL_BURST_THRESHOLD,
    MULTI_TOOL_BURST_WINDOW_SECONDS,
    ROLE_SHELL,
    TOOL_AWS,
    TOOL_CURL,
    TOOL_DOCKER,
    TOOL_GIT,
    TOOL_KUBECTL,
    TOOL_NPM,
    TOOL_PIP,
    TOOL_PYTHON,
    TOOL_SSH,
)
from ai_activity.detector import extract_secret_paths
from ai_activity.models import AISession, SessionFinding
from ai_activity.terminal_tracker import session_has_pty_or_shell
from rules.chain import parse_ts
from rules.constants import SEVERITY_HIGH, SEVERITY_MEDIUM, SEVERITY_SCORE


def evaluate_session(
    session: AISession,
    *,
    trigger: str,
    timestamp: str,
    context: dict[str, Any] | None = None,
) -> list[SessionFinding]:
    """Run incremental correlation rules; return newly created findings."""
    ctx = context or {}
    new_findings: list[SessionFinding] = []

    def once(finding_type: str) -> bool:
        return finding_type not in session._emitted_finding_types

    # 1) Terminal → tool chain
    if trigger in ("tool", "process_start") and once(FINDING_TERMINAL_TOOL_CHAIN):
        if session_has_pty_or_shell(session) and _has_interesting_tool(session):
            path = _tool_path_labels(session)
            finding = SessionFinding(
                finding_type=FINDING_TERMINAL_TOOL_CHAIN,
                severity=SEVERITY_MEDIUM,
                score=SEVERITY_SCORE[SEVERITY_MEDIUM],
                message=f"AI session ({session.app_name}) terminal tool chain: {' → '.join(path)}",
                timestamp=timestamp,
                detail={
                    "app_name": session.app_name,
                    "session_id": session.session_id,
                    "execution_path": path,
                },
            )
            new_findings.append(finding)

    # 2) Shell + curl/wget + external network
    if trigger in ("network", "tool") and once(FINDING_SHELL_NETWORK_EXFIL):
        if _shell_downloader_network(session):
            domains = list(session.external_domains[-5:])
            finding = SessionFinding(
                finding_type=FINDING_SHELL_NETWORK_EXFIL,
                severity=SEVERITY_HIGH,
                score=SEVERITY_SCORE[SEVERITY_HIGH],
                message=(
                    f"AI session ({session.app_name}) shell downloader reached "
                    f"{', '.join(domains) or 'external host'}"
                ),
                timestamp=timestamp,
                detail={
                    "app_name": session.app_name,
                    "session_id": session.session_id,
                    "domains": domains,
                    "execution_path": _tool_path_labels(session),
                },
            )
            new_findings.append(finding)

    # 3) Secrets access (skip when the more specific git-push finding applies)
    push_ctx = None
    if trigger in ("tool", "process_start", "file"):
        push_ctx = _secrets_git_push_context(session)

    if trigger in ("file", "process_start", "tool") and once(FINDING_SECRETS_ACCESS):
        if session.secrets_accessed and push_ctx is None:
            finding = SessionFinding(
                finding_type=FINDING_SECRETS_ACCESS,
                severity=SEVERITY_HIGH,
                score=SEVERITY_SCORE[SEVERITY_HIGH],
                message=(
                    f"AI session ({session.app_name}) accessed sensitive paths: "
                    f"{', '.join(session.secrets_accessed[:3])}"
                ),
                timestamp=timestamp,
                detail={
                    "app_name": session.app_name,
                    "session_id": session.session_id,
                    "secrets": list(session.secrets_accessed),
                    "execution_path": _tool_path_labels(session),
                },
            )
            new_findings.append(finding)

    # 3b) Secrets (.env / credential paths) + git push from AI session
    if trigger in ("tool", "process_start", "file") and once(FINDING_SECRETS_GIT_PUSH):
        if push_ctx is not None:
            secrets, cmdline, git_pid = push_ctx
            chain = _cursor_git_process_detail(session, git_pid, cmdline)
            secret_paths = secrets[:5]
            execution_path = _secrets_git_push_execution_path(
                session, secret_paths, git_pid
            )
            detail = {
                "app_name": session.app_name,
                "session_id": session.session_id,
                "secrets": secret_paths,
                "secret_path": secret_paths[0] if secret_paths else None,
                "git_cmdline": cmdline[:500],
                "execution_path": execution_path,
                "story": (
                    f"{chain.get('parent_comm')} accessed "
                    f"{', '.join(secret_paths)} then ran git push"
                ),
            }
            detail.update(chain)
            finding = SessionFinding(
                finding_type=FINDING_SECRETS_GIT_PUSH,
                severity=SEVERITY_HIGH,
                score=SEVERITY_SCORE[SEVERITY_HIGH] + 5,
                message=(
                    f"{chain.get('parent_comm') or session.app_name} accessed "
                    f"{secret_paths[0]} then attempted git push"
                ),
                timestamp=timestamp,
                detail=detail,
            )
            new_findings.append(finding)

    # 4) Cloud CLI (aws / kubectl / ssh)
    if trigger in ("tool", "process_start") and once(FINDING_CLOUD_CLI):
        if session.cloud_activity or session.k8s_activity or _has_tool_classes(
            session, {TOOL_AWS, TOOL_SSH, TOOL_KUBECTL}
        ):
            finding = SessionFinding(
                finding_type=FINDING_CLOUD_CLI,
                severity=SEVERITY_HIGH,
                score=SEVERITY_SCORE[SEVERITY_HIGH],
                message=f"AI session ({session.app_name}) invoked cloud/infra CLI tools",
                timestamp=timestamp,
                detail={
                    "app_name": session.app_name,
                    "session_id": session.session_id,
                    "cloud_activity": list(session.cloud_activity),
                    "k8s_activity": list(session.k8s_activity),
                    "execution_path": _tool_path_labels(session),
                },
            )
            new_findings.append(finding)

    # 5) Docker build/deploy + kubectl
    if trigger in ("tool", "process_start") and once(FINDING_CONTAINER_DEPLOY):
        has_docker = bool(session.docker_activity) or _has_tool_classes(session, {TOOL_DOCKER})
        has_k8s = bool(session.k8s_activity) or _has_tool_classes(session, {TOOL_KUBECTL})
        if has_docker and has_k8s:
            finding = SessionFinding(
                finding_type=FINDING_CONTAINER_DEPLOY,
                severity=SEVERITY_HIGH,
                score=SEVERITY_SCORE[SEVERITY_HIGH],
                message=f"AI session ({session.app_name}) container build/deploy activity",
                timestamp=timestamp,
                detail={
                    "app_name": session.app_name,
                    "session_id": session.session_id,
                    "docker_activity": list(session.docker_activity),
                    "k8s_activity": list(session.k8s_activity),
                    "execution_path": _tool_path_labels(session),
                },
            )
            new_findings.append(finding)

    # 6) Multi-tool burst
    if trigger in ("tool", "process_start") and once(FINDING_MULTI_TOOL_BURST):
        classes = _recent_tool_classes(session, timestamp, MULTI_TOOL_BURST_WINDOW_SECONDS)
        if len(classes) >= MULTI_TOOL_BURST_THRESHOLD:
            finding = SessionFinding(
                finding_type=FINDING_MULTI_TOOL_BURST,
                severity=SEVERITY_MEDIUM,
                score=SEVERITY_SCORE[SEVERITY_MEDIUM],
                message=(
                    f"AI session ({session.app_name}) ran {len(classes)} tool classes "
                    f"in {MULTI_TOOL_BURST_WINDOW_SECONDS}s"
                ),
                timestamp=timestamp,
                detail={
                    "app_name": session.app_name,
                    "session_id": session.session_id,
                    "tool_classes": sorted(classes),
                    "execution_path": _tool_path_labels(session),
                },
            )
            new_findings.append(finding)

    for finding in new_findings:
        session.findings.append(finding)
        session._emitted_finding_types.add(finding.finding_type)
        if finding.finding_type not in session.risk_factors:
            session.risk_factors.append(finding.finding_type)

    return new_findings


def _is_git_push_cmdline(cmdline: str) -> bool:
    """True when cmdline looks like a git push (including compound shell lines)."""
    lower = (cmdline or "").lower()
    if "git push" in lower or "git.exe push" in lower:
        return True
    # `git -C <path> push ...`, `git --git-dir=... push`, wrappers, etc.
    parts = lower.split()
    for i, p in enumerate(parts):
        base = p.rsplit("/", 1)[-1]
        if base not in {"git", "git.exe"}:
            continue
        j = i + 1
        while j < len(parts):
            tok = parts[j]
            if tok == "push":
                return True
            # Skip global/option args (and their values) before the subcommand.
            if tok.startswith("-"):
                # Options that take a following value: -C, -c, --git-dir, --work-tree, ...
                if tok in {"-c", "-C"} or tok.startswith("--git-dir") or tok.startswith("--work-tree"):
                    if "=" not in tok and j + 1 < len(parts):
                        j += 2
                        continue
                j += 1
                continue
            # First non-option token is the subcommand (not push).
            break
    return False


def _env_like_secrets(paths: list[str]) -> list[str]:
    out: list[str] = []
    for p in paths:
        lower = p.lower()
        if ".env" in lower or any(
            m in lower
            for m in (".ssh", "id_rsa", "id_ed25519", "credentials", "kubeconfig", "secrets.json")
        ):
            if p not in out:
                out.append(p)
    return out


def _prefer_full_secret_paths(paths: list[str]) -> list[str]:
    """Drop bare names like `.env` when a fuller path already covers them."""
    ordered = list(dict.fromkeys(p.strip() for p in paths if p and p.strip()))
    full = [p for p in ordered if "/" in p or p.startswith("~")]
    bare = [p for p in ordered if p not in full]
    out = list(full)
    for b in bare:
        if any(f == b or f.endswith("/" + b) or f.endswith(b) for f in out):
            continue
        out.append(b)
    return out


def _secrets_git_push_context(
    session: AISession,
) -> tuple[list[str], str, int | None] | None:
    """Return (secrets, git_push_cmdline, git_pid) when AI session pushed after secrets."""
    push_cmd = ""
    push_secrets: list[str] = []
    git_pid: int | None = None
    for t in session.tools:
        if t.tool_class != TOOL_GIT:
            continue
        cmd = t.cmdline or ""
        if not _is_git_push_cmdline(cmd):
            continue
        push_cmd = cmd
        git_pid = t.pid
        push_secrets.extend(extract_secret_paths(cmd))
    if not push_cmd:
        return None

    secrets = _prefer_full_secret_paths(
        _env_like_secrets(list(session.secrets_accessed) + push_secrets)
    )
    if not secrets:
        return None
    return secrets, push_cmd, git_pid


def _cursor_git_process_detail(session: AISession, git_pid: int | None, git_cmdline: str) -> dict:
    """Fields AlertsPage ProcessChainView already knows how to render."""
    root = session.processes.get(session.root_process_id)
    parent_comm = (root.name if root else None) or session.app_name or "cursor"
    parent_pid = session.root_pid
    parent_cmdline = (root.cmdline if root else "") or ""
    return {
        "parent_comm": parent_comm,
        "parent_pid": parent_pid,
        "parent_cmdline": parent_cmdline[:500] if parent_cmdline else None,
        "child_comm": "git",
        "child_pid": git_pid,
        "child_cmdline": (git_cmdline or "")[:500],
        "cursor_pid": parent_pid,
        "git_pid": git_pid,
    }


def _secrets_git_push_execution_path(
    session: AISession,
    secrets: list[str],
    git_pid: int | None,
) -> list[str]:
    """Full story path for one alert: Cursor → open .env → git push."""
    root = session.processes.get(session.root_process_id)
    parent = (root.name if root else None) or session.app_name or "Cursor"
    parent_pid = session.root_pid
    cursor_step = f"{parent} (pid {parent_pid})" if parent_pid else str(parent)
    path = [cursor_step]
    for secret in secrets[:3]:
        path.append(f"open {secret}")
    git_step = f"git push (pid {git_pid})" if git_pid else "git push"
    path.append(git_step)
    return path


def _has_interesting_tool(session: AISession) -> bool:
    interesting = {
        TOOL_GIT,
        TOOL_DOCKER,
        TOOL_SSH,
        TOOL_AWS,
        TOOL_KUBECTL,
        TOOL_NPM,
        TOOL_PIP,
        TOOL_PYTHON,
        TOOL_CURL,
    }
    return any(t.tool_class in interesting for t in session.tools)


def _has_tool_classes(session: AISession, classes: set[str]) -> bool:
    return any(t.tool_class in classes for t in session.tools)


def _tool_path_labels(session: AISession, *, limit: int = 10) -> list[str]:
    path = [session.app_name]
    for t in session.tools[-limit:]:
        label = t.name or t.tool_class
        if label and path[-1] != label:
            path.append(label)
    return path


def _shell_downloader_network(session: AISession) -> bool:
    has_shell = any(n.role == ROLE_SHELL for n in session.processes.values())
    has_curl = any(t.tool_class == TOOL_CURL for t in session.tools)
    has_ext = any(n.is_external for n in session.networks)
    return has_shell and has_curl and has_ext


def _recent_tool_classes(session: AISession, timestamp: str, window_s: int) -> set[str]:
    try:
        end = parse_ts(timestamp)
    except Exception:
        return {t.tool_class for t in session.tools if t.tool_class}
    start = end - timedelta(seconds=window_s)
    out: set[str] = set()
    for t in session.tools:
        if not t.tool_class:
            continue
        try:
            ts = parse_ts(t.timestamp)
        except Exception:
            out.add(t.tool_class)
            continue
        if start <= ts <= end:
            out.add(t.tool_class)
    return out
