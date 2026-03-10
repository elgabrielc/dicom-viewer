#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  agent-session-launch.sh [options] <agent> <topic> [tool args...]
  agent-session-launch.sh [options] --agent <agent> <topic> [tool args...]

Creates or reuses a dedicated agent worktree, then launches the requested tool
from inside that worktree.

Agent values:
  codex   -> codex/<topic>
  cc      -> cc/<topic>
  claude  -> alias for cc/<topic>

Options:
  --agent <agent>    Agent namespace to use for the branch/worktree
  --tool <command>   Tool to launch after entering the worktree
  --base <branch>    Base branch for new worktrees
  --root <dir>       Override AI_WORKTREE_HOME / ~/ai-worktrees
  --dry-run          Print what would happen without creating or launching
  --no-launch        Create or reuse the worktree, but do not launch the tool
  -h, --help         Show this help

Examples:
  ./scripts/agent-session-launch.sh --tool claude cc volume-rendering
  ./scripts/agent-session-launch.sh --tool codex codex bugfix-42 --resume
  ./scripts/agent-session-launch.sh --dry-run --tool claude claude docs-audit
EOF
}

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

default_base_branch() {
  if git rev-parse --verify --quiet local/WIP^{commit} >/dev/null; then
    printf '%s\n' "local/WIP"
  elif git rev-parse --verify --quiet main^{commit} >/dev/null; then
    printf '%s\n' "main"
  elif git rev-parse --verify --quiet master^{commit} >/dev/null; then
    printf '%s\n' "master"
  else
    git branch --show-current
  fi
}

find_attached_worktree_for_branch() {
  local branch_ref="refs/heads/$1"

  git worktree list --porcelain | awk -v branch_ref="$branch_ref" '
    $1 == "worktree" { current_path = substr($0, 10) }
    $1 == "branch" && $2 == branch_ref { print current_path; exit 0 }
  '
}

has_project_helper_script() {
  [[ -x "$REPO_ROOT/scripts/agent-worktree-new.sh" ]]
}

has_project_worktree_npm_script() {
  [[ -f "$REPO_ROOT/package.json" ]] || return 1

  node -e '
const pkg = require(process.argv[1]);
process.exit(pkg.scripts && pkg.scripts["worktree:new"] ? 0 : 1);
' "$REPO_ROOT/package.json" >/dev/null 2>&1
}

create_worktree() {
  if has_project_helper_script; then
    "$REPO_ROOT/scripts/agent-worktree-new.sh" \
      --base "$BASE_BRANCH" \
      --root "$WORKTREE_HOME" \
      "$AGENT" \
      "$TOPIC_RAW"
    return
  fi

  if has_project_worktree_npm_script; then
    (
      cd "$REPO_ROOT"
      npm run worktree:new -- \
        --base "$BASE_BRANCH" \
        --root "$WORKTREE_HOME" \
        "$AGENT" \
        "$TOPIC_RAW"
    )
    return
  fi

  mkdir -p "$WORKTREE_ROOT"
  git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" "$BASE_BRANCH"
}

DRY_RUN=0
NO_LAUNCH=0
TOOL_CMD=""
AGENT_OVERRIDE=""
BASE_BRANCH=""
ROOT_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)
      AGENT_OVERRIDE="${2:-}"
      shift 2
      ;;
    --tool)
      TOOL_CMD="${2:-}"
      shift 2
      ;;
    --base)
      BASE_BRANCH="${2:-}"
      shift 2
      ;;
    --root)
      ROOT_OVERRIDE="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --no-launch)
      NO_LAUNCH=1
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

if [[ -n "$AGENT_OVERRIDE" ]]; then
  if [[ $# -lt 1 ]]; then
    usage >&2
    exit 1
  fi

  AGENT="$AGENT_OVERRIDE"
  TOPIC_RAW="$1"
  shift
else
  if [[ $# -lt 2 ]]; then
    usage >&2
    exit 1
  fi

  AGENT="$1"
  TOPIC_RAW="$2"
  shift 2
fi

TOOL_ARGS=("$@")

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "This launcher must be run inside a git worktree." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$REPO_ROOT")"
CURRENT_BRANCH="$(git branch --show-current)"
CURRENT_STATUS="$(git status --short)"
CURRENT_PATH="$(pwd -P)"

TOPIC_SLUG="$(slugify "$TOPIC_RAW")"
if [[ -z "$TOPIC_SLUG" ]]; then
  echo "Topic must contain at least one alphanumeric character." >&2
  exit 1
fi

case "$AGENT" in
  codex)
    BRANCH_PREFIX="codex"
    ;;
  cc|claude)
    BRANCH_PREFIX="cc"
    ;;
  *)
    echo "Agent must be 'codex', 'cc', or 'claude'." >&2
    exit 1
    ;;
esac

if [[ -z "$BASE_BRANCH" ]]; then
  BASE_BRANCH="$(default_base_branch)"
fi

git rev-parse --verify "$BASE_BRANCH^{commit}" >/dev/null

WORKTREE_HOME="${ROOT_OVERRIDE:-${AI_WORKTREE_HOME:-$HOME/ai-worktrees}}"
WORKTREE_ROOT="${WORKTREE_HOME%/}/$REPO_NAME"
BRANCH_NAME="$BRANCH_PREFIX/$TOPIC_SLUG"
WORKTREE_PATH="$WORKTREE_ROOT/$BRANCH_PREFIX-$TOPIC_SLUG"

if [[ -z "$TOOL_CMD" ]]; then
  TOOL_CMD="$AGENT"
  if [[ "$TOOL_CMD" == "cc" ]]; then
    TOOL_CMD="claude"
  fi
fi

if [[ "$CURRENT_BRANCH" == "$BRANCH_NAME" ]]; then
  WORKTREE_PATH="$REPO_ROOT"
  BRANCH_ALREADY_EXISTS=1
else
  BRANCH_ALREADY_EXISTS=0
  if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    BRANCH_ALREADY_EXISTS=1
    ATTACHED_WORKTREE="$(find_attached_worktree_for_branch "$BRANCH_NAME")"
    if [[ -n "$ATTACHED_WORKTREE" ]]; then
      WORKTREE_PATH="$ATTACHED_WORKTREE"
    fi
  fi
fi

if [[ "$BRANCH_ALREADY_EXISTS" -eq 0 ]] && [[ "$CURRENT_BRANCH" == "$BASE_BRANCH" ]] && [[ -n "$CURRENT_STATUS" ]] && [[ "$CURRENT_PATH" == "$REPO_ROOT" ]]; then
  echo "Refusing to create a new agent worktree from dirty $BASE_BRANCH." >&2
  echo "Capture or commit the shared checkout state first, then retry." >&2
  exit 1
fi

echo "Repo root:      $REPO_ROOT"
echo "Base branch:    $BASE_BRANCH"
echo "Agent branch:   $BRANCH_NAME"
echo "Worktree path:  $WORKTREE_PATH"
echo "Launch tool:    $TOOL_CMD"

if [[ "$AGENT" == "claude" ]] && git show-ref --verify --quiet refs/heads/claude; then
  echo "Namespace note: using cc/* because the bare 'claude' branch blocks claude/* in this repo."
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  if [[ "$BRANCH_ALREADY_EXISTS" -eq 1 ]]; then
    echo "Dry run: would reuse existing branch/worktree if available."
  else
    echo "Dry run: would create a new branch and worktree."
  fi
  if [[ "$NO_LAUNCH" -eq 1 ]]; then
    echo "Dry run: would not launch the tool."
  else
    echo "Dry run: would launch '$TOOL_CMD' from the worktree."
  fi
  exit 0
fi

if [[ "$BRANCH_ALREADY_EXISTS" -eq 0 ]]; then
  create_worktree
elif [[ ! -d "$WORKTREE_PATH" ]]; then
  mkdir -p "$WORKTREE_ROOT"
  git worktree add "$WORKTREE_PATH" "$BRANCH_NAME"
fi

if [[ "$NO_LAUNCH" -eq 1 ]]; then
  echo
  echo "Worktree ready."
  echo "Open: $WORKTREE_PATH"
  echo "Branch: $BRANCH_NAME"
  exit 0
fi

if ! command -v "$TOOL_CMD" >/dev/null 2>&1; then
  echo "Tool not found in PATH: $TOOL_CMD" >&2
  echo "Worktree is ready at: $WORKTREE_PATH" >&2
  exit 1
fi

echo
echo "Launching $TOOL_CMD in $WORKTREE_PATH"
cd "$WORKTREE_PATH"
exec "$TOOL_CMD" "${TOOL_ARGS[@]}"
