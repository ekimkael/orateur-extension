#!/usr/bin/env bash
# Git Flow guard for pull requests, run by .github/workflows/ci.yml.
# Reads GITHUB_HEAD_REF and GITHUB_BASE_REF (set by GitHub on pull_request events).
set -euo pipefail

# Conventional Commit types accepted on develop. Add project types here (e.g. content).
TYPES="feat|fix|refactor|perf|docs|test|ci|chore|build|revert|security|style"
VERSION='[0-9]+\.[0-9]+\.[0-9]+'

head=${GITHUB_HEAD_REF:?} base=${GITHUB_BASE_REF:?}
fail() { printf '::error::%b\n' "$1"; exit 1; }

case $base in
  main)
    [[ $head =~ ^(release|hotfix)/($VERSION)$ ]] ||
      fail "PRs into main come from release/x.y.z or hotfix/x.y.z, not $head."
    version=${BASH_REMATCH[2]}
    pkg=$(node -p 'require("./package.json").version')
    [[ $pkg == "$version" ]] || fail "package.json is at $pkg but the branch is $head."
    node scripts/validate-changelog.mjs "$version"
    ;;
  develop)
    [[ $head =~ ^((feature|fix|refactor|docs|chore)/.+|(release|hotfix)/$VERSION|dependabot/.+)$ ]] ||
      fail "Branch $head needs a feature/, fix/, refactor/, docs/ or chore/ prefix."
    # Commits are checked here only: a release PR into main also carries older history.
    bad=$(git log --no-merges --format=%s "origin/$base..HEAD" | grep -vE "^($TYPES)(\(.+\))?!?: " || true)
    [[ -z $bad ]] || fail "Commits not in Conventional Commits format:\n$bad"
    ;;
  *)
    fail "PRs target develop or main, not $base."
    ;;
esac
echo "Git Flow check passed: $head → $base."
