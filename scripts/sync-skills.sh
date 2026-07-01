#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [target-skills-dir]" >&2
  exit 2
fi

if [[ $# -eq 1 ]]; then
  target_dir="$1"
elif [[ -d "$repo_root/../../.agents/skills" ]]; then
  target_dir="$repo_root/../../.agents/skills"
else
  target_dir="${CODEX_HOME:-$HOME/.codex}/skills"
fi

mkdir -p "$target_dir"

for skill_dir in "$repo_root"/skills/sdd-*; do
  [[ -d "$skill_dir" ]] || continue
  skill_name="$(basename "$skill_dir")"
  mkdir -p "$target_dir/$skill_name"
  rsync -a --delete "$skill_dir/" "$target_dir/$skill_name/"
  echo "synced $skill_name -> $target_dir/$skill_name"
done

echo "SDD skills synced to $target_dir"
