#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") --source <path> [--app-root <path>] [--keep <count>] [--no-nginx-reload]

Options:
  --source <path>        Required. Source directory or .tar/.tar.gz release archive.
  --app-root <path>      App root on server. Default: /var/www/csv-dashboard
  --keep <count>         Number of releases to retain. Default: 8
  --no-nginx-reload      Skip nginx config test + reload
  -h, --help             Show this help text

Examples:
  $(basename "$0") --source /home/deploy/csv-dashboard/app-web
  $(basename "$0") --source /tmp/csv-dashboard-web.tar.gz --app-root /var/www/csv-dashboard --keep 12
USAGE
}

SOURCE=""
APP_ROOT="/var/www/csv-dashboard"
KEEP_RELEASES=8
RELOAD_NGINX=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      SOURCE="${2:-}"
      shift 2
      ;;
    --app-root)
      APP_ROOT="${2:-}"
      shift 2
      ;;
    --keep)
      KEEP_RELEASES="${2:-}"
      shift 2
      ;;
    --no-nginx-reload)
      RELOAD_NGINX=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$SOURCE" ]]; then
  echo "--source is required." >&2
  usage
  exit 1
fi

if [[ ! -e "$SOURCE" ]]; then
  echo "Source path does not exist: $SOURCE" >&2
  exit 1
fi

if ! [[ "$KEEP_RELEASES" =~ ^[0-9]+$ ]] || [[ "$KEEP_RELEASES" -lt 1 ]]; then
  echo "--keep must be a positive integer." >&2
  exit 1
fi

RELEASES_DIR="$APP_ROOT/releases"
LATEST_LINK="$APP_ROOT/latest"
TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="$RELEASES_DIR/$TIMESTAMP"

mkdir -p "$RELEASES_DIR"
mkdir -p "$RELEASE_DIR"

if [[ -d "$SOURCE" ]]; then
  rsync -a --delete --exclude '.DS_Store' "$SOURCE"/ "$RELEASE_DIR"/
elif [[ -f "$SOURCE" ]]; then
  case "$SOURCE" in
    *.tar.gz|*.tgz)
      tar -xzf "$SOURCE" -C "$RELEASE_DIR"
      ;;
    *.tar)
      tar -xf "$SOURCE" -C "$RELEASE_DIR"
      ;;
    *)
      echo "Unsupported archive format: $SOURCE" >&2
      echo "Use a source directory, .tar, .tar.gz, or .tgz" >&2
      exit 1
      ;;
  esac
else
  echo "Unsupported source type: $SOURCE" >&2
  exit 1
fi

# Minimal sanity check before flipping traffic.
if [[ ! -f "$RELEASE_DIR/index.html" ]]; then
  echo "Release missing index.html: $RELEASE_DIR/index.html" >&2
  exit 1
fi

ln -sfn "$RELEASE_DIR" "$LATEST_LINK"

if [[ "$RELOAD_NGINX" -eq 1 ]]; then
  sudo nginx -t
  sudo systemctl reload nginx
fi

mapfile -t OLD_RELEASES < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)

if (( ${#OLD_RELEASES[@]} > KEEP_RELEASES )); then
  REMOVE_COUNT=$(( ${#OLD_RELEASES[@]} - KEEP_RELEASES ))
  for (( i=0; i<REMOVE_COUNT; i++ )); do
    rm -rf "$RELEASES_DIR/${OLD_RELEASES[$i]}"
  done
fi

echo "Deployed release: $RELEASE_DIR"
echo "Latest symlink: $LATEST_LINK -> $(readlink "$LATEST_LINK")"
