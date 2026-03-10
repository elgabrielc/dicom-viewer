#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  agent-worktree-retire.sh [--dry-run] [--into <branch>] [--delete-remote] <branch>

Safely removes an agent worktree and deletes its local branch after the branch
has been integrated into the target branch.

Defaults:
  integration branch: local/WIP

Examples:
  ./scripts/agent-worktree-retire.sh codex/visage-research
  ./scripts/agent-worktree-retire.sh --into main cc/docs-audit
  ./scripts/agent-worktree-retire.sh --dry-run codex/ohif-deep-dive
EOF
}

find_worktree_for_branch() {
  local target="$1"
  local path=""
  local branch=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -z "$line" ]]; then
      if [[ "$branch" == "$target" ]]; then
        printf '%s\n' "$path"
        return 0
      fi
      path=""
      branch=""
      continue
    fi

    case "$line" in
      worktree\ *)
        path="${line#worktree }"
        ;;
      branch\ refs/heads/*)
        branch="${line#branch refs/heads/}"
        ;;
      detached)
        branch=""
        ;;
    esac
  done < <(git worktree list --porcelain && printf '\n')

  return 1
}

DRY_RUN=0
INTO_BRANCH="local/WIP"
DELETE_REMOTE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --into)
      INTO_BRANCH="${2:-}"
      shift 2
      ;;
    --delete-remote)
      DELETE_REMOTE=1
      shift
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

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 1
fi

BRANCH_NAME="$1"
REPO_ROOT="$(git rev-parse --show-toplevel)"

git rev-parse --verify "$BRANCH_NAME^{commit}" >/dev/null
git rev-parse --verify "$INTO_BRANCH^{commit}" >/dev/null

if ! git merge-base --is-ancestor "$BRANCH_NAME" "$INTO_BRANCH"; then
  echo "Refusing to retire $BRANCH_NAME: it is not merged into $INTO_BRANCH." >&2
  exit 1
fi

ATTACHED_PATH="$(find_worktree_for_branch "$BRANCH_NAME" || true)"

echo "Repo root:         $REPO_ROOT"
echo "Branch to retire:  $BRANCH_NAME"
echo "Merged into:       $INTO_BRANCH"

if [[ -n "$ATTACHED_PATH" ]]; then
  echo "Attached worktree: $ATTACHED_PATH"

  if [[ "$ATTACHED_PATH" == "$REPO_ROOT" ]]; then
    echo "Refusing to retire the branch checked out in the current worktree." >&2
    exit 1
  fi

  if [[ -n "$(git -C "$ATTACHED_PATH" status --short 2>/dev/null)" ]]; then
    echo "Refusing to remove $ATTACHED_PATH: worktree is dirty." >&2
    exit 1
  fi
else
  echo "Attached worktree: (none)"
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo
  echo "Dry run only. No worktree or branch removed."
  exit 0
fi

if [[ -n "$ATTACHED_PATH" ]]; then
  git worktree remove "$ATTACHED_PATH"
fi

git branch -d "$BRANCH_NAME"

if [[ "$DELETE_REMOTE" -eq 1 ]]; then
  git push origin --delete "$BRANCH_NAME"
fi

echo
echo "Retired $BRANCH_NAME"
