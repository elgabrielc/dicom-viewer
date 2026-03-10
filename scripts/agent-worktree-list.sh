#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  agent-worktree-list.sh [--all]

Lists active agent worktrees. By default this shows only codex/* and claude/* branches.
Use --all to include every linked worktree in the repository.
EOF
}

SHOW_ALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      SHOW_ALL=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

is_agent_branch() {
  case "$1" in
    codex/*|claude/*) return 0 ;;
    *) return 1 ;;
  esac
}

status_for_path() {
  local path="$1"
  if [[ -n "$(git -C "$path" status --short 2>/dev/null)" ]]; then
    printf 'dirty'
  else
    printf 'clean'
  fi
}

print_entry() {
  local path="$1"
  local branch="$2"
  local head="$3"

  if [[ -z "$path" ]]; then
    return
  fi

  if [[ -z "$branch" ]]; then
    branch="(detached)"
  fi

  if [[ "$SHOW_ALL" -ne 1 ]] && ! is_agent_branch "$branch"; then
    return
  fi

  printf '%-36s %-10s %-8s %s\n' "$branch" "${head:0:10}" "$(status_for_path "$path")" "$path"
}

REPO_ROOT="$(git rev-parse --show-toplevel)"

echo "Repo: $REPO_ROOT"
echo
printf '%-36s %-10s %-8s %s\n' "BRANCH" "HEAD" "STATUS" "PATH"
printf '%-36s %-10s %-8s %s\n' "------" "----" "------" "----"

current_path=""
current_branch=""
current_head=""

while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ -z "$line" ]]; then
    print_entry "$current_path" "$current_branch" "$current_head"
    current_path=""
    current_branch=""
    current_head=""
    continue
  fi

  case "$line" in
    worktree\ *)
      current_path="${line#worktree }"
      ;;
    HEAD\ *)
      current_head="${line#HEAD }"
      ;;
    branch\ refs/heads/*)
      current_branch="${line#branch refs/heads/}"
      ;;
    detached)
      current_branch=""
      ;;
  esac
done < <(git worktree list --porcelain && printf '\n')
