#!/usr/bin/env bash
# Cut packages/camp (with its history) into a branch for the public repository camp-protocol/camp.
# This repository stays the source of truth; run this again to sync, then push the branch yourself.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain packages/camp)" ]; then
  echo "packages/camp has uncommitted changes. Commit them first." >&2
  exit 1
fi
branch="${1:-camp-public}"
git subtree split --prefix packages/camp -b "$branch"
# Nothing private may go public
if git grep -nIiE 'idea-audition-run|ACCESS_CODE=|GOOGLE_CLOUD_PROJECT|\.iam\.gserviceaccount\.com' "$branch" -- . ; then
  echo "Found project-specific values in $branch. Stop and check." >&2
  exit 1
fi
echo "Branch $branch: $(git rev-list --count "$branch") commits, $(git ls-tree -r --name-only "$branch" | wc -l | tr -d ' ') files."
echo "Push it to the public repository with:"
echo "  git push git@github.com:camp-protocol/camp.git $branch:main"
