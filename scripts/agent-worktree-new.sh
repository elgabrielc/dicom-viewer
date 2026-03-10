#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  agent-worktree-new.sh [--dry-run] [--base <branch>] [--root <dir>] <agent> <topic>

Creates a dedicated branch and worktree for one AI agent.

Defaults:
  base branch: local/WIP
  worktree root: $AI_WORKTREE_HOME/<repo-name> or ~/ai-worktrees/<repo-name>

Examples:
  ./scripts/agent-worktree-new.sh codex visage-research
  ./scripts/agent-worktree-new.sh --base main claude docs-audit
  ./scripts/agent-worktree-new.sh --dry-run codex ohif-deep-dive
EOF
}

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

DRY_RUN=0
BASE_BRANCH="local/WIP"
ROOT_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --base)
      BASE_BRANCH="${2:-}"
      shift 2
      ;;
    --root)
      ROOT_OVERRIDE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      break
      ;;
  esac
done

if [[ $# -ne 2 ]]; then
  usage >&2
  exit 1
fi

AGENT="$1"
TOPIC_RAW="$2"
TOPIC_SLUG="$(slugify "$TOPIC_RAW")"

if [[ -z "$TOPIC_SLUG" ]]; then
  echo "Topic must contain at least one alphanumeric character." >&2
  exit 1
fi

case "$AGENT" in
  codex|claude)
    ;;
  *)
    echo "Agent must be 'codex' or 'claude'." >&2
    exit 1
    ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$REPO_ROOT")"
WORKTREE_HOME="${ROOT_OVERRIDE:-${AI_WORKTREE_HOME:-$HOME/ai-worktrees}}"
WORKTREE_ROOT="${WORKTREE_HOME%/}/$REPO_NAME"
BRANCH_NAME="$AGENT/$TOPIC_SLUG"
WORKTREE_PATH="$WORKTREE_ROOT/$AGENT-$TOPIC_SLUG"
CURRENT_BRANCH="$(git branch --show-current)"

git rev-parse --verify "$BASE_BRANCH^{commit}" >/dev/null

if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  echo "Branch already exists: $BRANCH_NAME" >&2
  exit 1
fi

if [[ -e "$WORKTREE_PATH" ]]; then
  echo "Worktree path already exists: $WORKTREE_PATH" >&2
  exit 1
fi

if [[ "$CURRENT_BRANCH" == "$BASE_BRANCH" ]] && [[ -n "$(git status --short)" ]]; then
  echo "Note: $BASE_BRANCH has uncommitted changes; the new branch starts from the last commit only." >&2
fi

echo "Repo root:      $REPO_ROOT"
echo "Base branch:    $BASE_BRANCH"
echo "Agent branch:   $BRANCH_NAME"
echo "Worktree path:  $WORKTREE_PATH"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo
  echo "Dry run only. No branch or worktree created."
  exit 0
fi

mkdir -p "$WORKTREE_ROOT"
git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" "$BASE_BRANCH"

echo
echo "Created agent worktree."
echo "Open: $WORKTREE_PATH"
echo "Branch: $BRANCH_NAME"
