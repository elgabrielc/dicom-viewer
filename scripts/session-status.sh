#!/usr/bin/env bash
# session-status.sh -- "Where did we leave off?" narrative briefing
# [EDITORIAL: ...] markers are filled in by Claude with 1-2 sentences.
# Read-only. Copyright Divergent Health Technologies

set -uo pipefail

REPO_ROOT="$(git -C "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" rev-parse --show-toplevel)"

FETCH=1 MERGED_PR_LIMIT=15
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-fetch) FETCH=0; shift ;;
    --merged) MERGED_PR_LIMIT="$2"; shift 2 ;;
    -h|--help) echo "Usage: session-status.sh [--no-fetch] [--merged <N>]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

have_gh() { command -v gh >/dev/null 2>&1; }
g() { git -C "$REPO_ROOT" "$@"; }

[[ "$FETCH" -eq 1 ]] && g fetch origin --quiet 2>&1 || true

# === COLLECT ===============================================================

LOCAL_AHEAD=$(g rev-list --count origin/main..main 2>/dev/null || echo "?")
LOCAL_BEHIND=$(g rev-list --count main..origin/main 2>/dev/null || echo "?")
BEHIND_LOG=$(g log --oneline main..origin/main 2>/dev/null || true)

STATUS_SHORT=$(g status --short)
MODIFIED=$(echo "$STATUS_SHORT" | grep -v '^??' || true)
UNTRACKED=$(echo "$STATUS_SHORT" | grep '^??' | sed 's/^?? //' || true)

STASH_LIST=$(g stash list 2>/dev/null || true)
[[ -z "$STASH_LIST" ]] && STASH_COUNT=0 || STASH_COUNT=$(echo "$STASH_LIST" | wc -l | xargs)

STASH0_SUMMARY=""
if [[ "$STASH_COUNT" -gt 0 ]]; then
  STASH0_SUMMARY=$(g stash show stash@\{0\} --numstat --format="" 2>/dev/null | awk -F'\t' '
    NR<=5 { if($1=="-") s=$3" (binary)"; else s=$3" +"$1; out=out (NR>1?"; ":"") s }
    END { if(NR>5) out=out"; ... and "(NR-5)" more"; print out }' || true)
fi

OPEN_PRS_JSON="[]" MERGED_JSON="[]" MERGED_BRANCHES=""
if have_gh; then
  OPEN_PRS_JSON=$(gh pr list --state open --limit 30 \
    --json number,title,headRefName,isDraft,statusCheckRollup,additions,deletions,changedFiles 2>/dev/null || echo "[]")
  MERGED_JSON=$(gh pr list --state merged --limit 100 \
    --json number,title,headRefName 2>/dev/null || echo "[]")
  MERGED_BRANCHES=$(echo "$MERGED_JSON" | python3 -c 'import json,sys;[print(p["headRefName"])for p in json.load(sys.stdin)]' 2>/dev/null || true)
fi

declare -a WT_BRANCHES=() WT_PATHS=()
_p="" _b=""
while IFS= read -r line; do
  case "$line" in
    worktree\ *) _p="${line#worktree }" ;;
    branch\ refs/heads/*) _b="${line#branch refs/heads/}" ;;
    detached) _b="(detached)" ;;
    "") [[ -n "$_p" ]] && WT_BRANCHES+=("${_b:-}") && WT_PATHS+=("$_p") && _p="" _b="" ;;
  esac
done < <(g worktree list --porcelain && printf '\n')

DIRTY_TMP=$(mktemp)
for i in "${!WT_PATHS[@]}"; do
  ( [[ -n "$(git -C "${WT_PATHS[$i]}" status --short 2>/dev/null)" ]] && echo "$i" ) >> "$DIRTY_TMP" &
done; wait
DIRTY_IDX=":$(tr '\n' ':' < "$DIRTY_TMP")"; rm -f "$DIRTY_TMP"

# === FORMAT ================================================================

echo ""
echo "Where We Left Off"
echo ""

# Branch sync
if [[ "$LOCAL_BEHIND" == "0" && "$LOCAL_AHEAD" == "0" ]]; then
  echo "Local main is up to date with origin/main."
elif [[ "$LOCAL_BEHIND" == "0" ]]; then
  echo "Local main is ${LOCAL_AHEAD} commits ahead of origin/main."
else
  echo "Main branch is ${LOCAL_BEHIND} commits behind origin/main"
  echo ""
  echo "Your local main is behind origin/main by ${LOCAL_BEHIND} commits -- not blocking, just a fast-forward. What's landed since you last synced:"
  echo ""
  echo "$BEHIND_LOG"
  echo ""
  echo "[EDITORIAL: 1-2 sentences on what shipped]"
fi

# Open PRs
if [[ "$OPEN_PRS_JSON" != "[]" ]]; then
  printf '\n---\n'
  echo "$OPEN_PRS_JSON" | python3 -c '
import json, sys
for pr in json.load(sys.stdin):
    n, t, b = pr["number"], pr["title"], pr["headRefName"]
    d = " [DRAFT]" if pr.get("isDraft") else ""
    R = pr.get("statusCheckRollup") or []
    F = lambda *s: [c.get("name","?") for c in R if (c.get("conclusion") or c.get("state") or "").upper() in s]
    f, p = F("FAILURE","FAILED","ERROR","CANCELLED"), F("PENDING","QUEUED","IN_PROGRESS")
    st = ("OPEN, blocked on "+", ".join(f)) if f else "OPEN, checks pending" if p else "OPEN, all checks pass" if R else "OPEN"
    print(f"Active work: PR #{n}{d} -- {t} ({st})")
    print(f"Branch: {b}. [EDITORIAL: what this PR bundles]")
    if R:
        def lbl(c):
            v=(c.get("conclusion")or c.get("state")or"").upper()
            return "FAIL" if v in("FAILURE","FAILED","ERROR","CANCELLED") else "PENDING" if v in("PENDING","QUEUED","IN_PROGRESS") else "PASS"
        print("CI: "+" | ".join(f"{c.get(\"name\",\"?\")}: {lbl(c)}" for c in R))
    a,dl,fc=pr.get("additions",0),pr.get("deletions",0),pr.get("changedFiles",0)
    if fc: print(f"Scope: {fc} files (+{a} -{dl})")
    print()
' 2>/dev/null || true
fi

# Uncommitted state
printf '\n---\nUncommitted local state (main checkout)\n\n'

[[ -n "$MODIFIED" ]] && { echo "Modified/staged:"; echo "$MODIFIED" | while IFS= read -r l; do echo "  $l"; done; echo ""; }

ITEM=1
if [[ "$STASH_COUNT" -gt 0 ]]; then
  echo "${ITEM}. Stash stash@{0}: \"$(echo "$STASH_LIST" | head -1 | sed 's/^[^:]*: [^:]*: //')\""
  [[ -n "$STASH0_SUMMARY" ]] && echo "   Files: ${STASH0_SUMMARY}"
  echo "   [EDITORIAL: what this stash represents and whether to act on it]"
  ITEM=$((ITEM + 1))
fi

if [[ -n "$UNTRACKED" ]]; then
  TOTAL_UT=$(echo "$UNTRACKED" | wc -l | tr -d ' ')
  RESEARCH_CT=$(echo "$UNTRACKED" | grep -cE 'RESEARCH-.*(-prompt\.md|_thinking\.md)$' 2>/dev/null || true)
  RESEARCH_CT=${RESEARCH_CT:-0}; RESEARCH_CT=${RESEARCH_CT// /}
  OTHER_CT=$((TOTAL_UT - RESEARCH_CT))
  PNG_CT=$(echo "$UNTRACKED" | grep -cE '\.(png|jpg)$' 2>/dev/null || true)
  PNG_CT=${PNG_CT:-0}; PNG_CT=${PNG_CT// /}
  PLAN_CT=$(echo "$UNTRACKED" | grep -c '^docs/planning/' 2>/dev/null || true)
  PLAN_CT=${PLAN_CT:-0}; PLAN_CT=${PLAN_CT// /}
  PLAN_CT=$((PLAN_CT > RESEARCH_CT ? PLAN_CT - RESEARCH_CT : 0))
  echo "${ITEM}. ${TOTAL_UT} untracked files: ${RESEARCH_CT} research exhaust, ${PNG_CT} screenshots, ${PLAN_CT} planning docs, $((OTHER_CT - PNG_CT - PLAN_CT)) other."
  echo "$UNTRACKED" | grep -vE 'RESEARCH-.*(-prompt\.md|_thinking\.md)$' | grep -vE '\.(png|jpg)$' | grep -vE '^docs/planning/RESEARCH-' | head -8 | while IFS= read -r f; do
    [[ -n "$f" ]] && echo "   - $f"
  done
  ITEM=$((ITEM + 1))
fi

[[ "$STASH_COUNT" -gt 1 ]] && echo "${ITEM}. $((STASH_COUNT - 1)) older stashes -- [EDITORIAL: brief assessment]"
echo ""

# Worktrees
echo "---"
ACTIVE="" STALE="" STALE_CT=0 AGENT_CT=0 DIRTY_CT=0

for i in "${!WT_BRANCHES[@]}"; do
  b="${WT_BRANCHES[$i]}"
  [[ "$b" == "main" || "$b" == "master" || "$b" == "(detached)" ]] && continue
  [[ ! "$b" =~ ^(codex|cc)/ ]] && continue
  AGENT_CT=$((AGENT_CT + 1))
  st="clean"; [[ "$DIRTY_IDX" == *":${i}:"* ]] && st="dirty" && DIRTY_CT=$((DIRTY_CT + 1))
  if [[ -n "$MERGED_BRANCHES" ]] && echo "$MERGED_BRANCHES" | grep -qx "$b" 2>/dev/null; then
    STALE_CT=$((STALE_CT + 1)); [[ -n "$STALE" ]] && STALE+=", "; STALE+="$b"
  else
    ACTIVE+="- ${b} (${st})"$'\n'
  fi
done

echo "Worktrees (${#WT_BRANCHES[@]} total, ${AGENT_CT} agent, ${DIRTY_CT} dirty)"
echo ""
[[ -n "$ACTIVE" ]] && { echo "Active:"; printf '%s' "$ACTIVE"; echo ""; }
[[ "$STALE_CT" -gt 0 ]] && echo "Stale (${STALE_CT} worktrees, PRs merged): ${STALE}." && echo ""

for i in "${!WT_PATHS[@]}"; do
  p="${WT_PATHS[$i]}"
  [[ "$p" != "$REPO_ROOT" && ! "$p" =~ ai-worktrees/dicom-viewer/ ]] && echo "Note: ${WT_BRANCHES[$i]} is outside ~/ai-worktrees/dicom-viewer/ at ${p/#$HOME/~}"
done

# Merged PRs
if [[ "$MERGED_JSON" != "[]" ]]; then
  printf '\n---\nLast few days of shipped work (for context)\n\nRecently merged:\n'
  echo "$MERGED_JSON" | python3 -c "
import json,sys
for p in json.load(sys.stdin)[:${MERGED_PR_LIMIT}]:print(f\"- #{p['number']} {p['title']}\")" 2>/dev/null || true
  printf '\n[EDITORIAL: The big threads: followed by 3-5 numbered themes]\n'
fi

# Recommendations
printf '\n---\nRecommended next actions\n\n'
R=1
[[ "$LOCAL_BEHIND" != "0" && "$LOCAL_BEHIND" != "?" ]] && echo "${R}. Fast-forward local main -- ${LOCAL_BEHIND} commits behind." && R=$((R + 1))
[[ "$STASH_COUNT" -gt 0 ]] && echo "${R}. Deal with stash@{0} -- [EDITORIAL: specific advice]." && R=$((R + 1))
[[ "$STALE_CT" -gt 0 ]] && echo "${R}. Clean up ${STALE_CT} stale worktrees." && R=$((R + 1))
[[ "${OTHER_CT:-0}" -gt 0 ]] && echo "${R}. Decide on ${OTHER_CT:-0} untracked files." && R=$((R + 1))
[[ "$R" -eq 1 ]] && echo "Nothing urgent -- clean and up to date."
echo ""
