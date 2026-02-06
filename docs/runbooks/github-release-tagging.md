# GitHub Release Tagging Runbook

## Purpose

Create a version tag that triggers multi-platform standalone binary builds and release publishing.

## Workflow Source

- `.github/workflows/release-binaries.yml`

Trigger conditions:

- Push tags matching `v*`
- Manual workflow dispatch

## Pre-Release Checklist

```bash
cd /Users/bunni/workspace/csv-dasboard
git checkout main
git pull origin main
npm test
```

## Create and Push a Release Tag

Example for version `v0.2.0`:

```bash
git tag v0.2.0
git push origin v0.2.0
```

## Expected GitHub Outputs

- A workflow run for each target platform:
  - windows-x86_64
  - macos-arm64
- A GitHub Release for the tag with attached binaries:
  - `csv-dashboard-windows-x86_64.exe`
  - `csv-dashboard-macos-arm64.app.zip`

## If You Need to Re-run

- Re-run failed jobs from Actions UI, or
- Delete and recreate the tag:

```bash
git tag -d v0.2.0
git push origin :refs/tags/v0.2.0
git tag v0.2.0
git push origin v0.2.0
```
