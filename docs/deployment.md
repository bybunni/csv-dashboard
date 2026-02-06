# Deployment Guide (Ubuntu + Nginx)

## Architecture

This app is deployed as a static site:

- Nginx serves files from `/var/www/csv-dashboard/latest`
- Each deploy creates a timestamped release under `/var/www/csv-dashboard/releases/<timestamp>`
- `latest` is a symlink switched atomically to the new release
- Old releases are retained for rollback

No Node.js process manager or backend runtime is required in production.

## Files in This Repo

- Nginx site config: `/Users/bunni/workspace/csv-dasboard/deploy/nginx/csv-dashboard.conf`
- Deploy script: `/Users/bunni/workspace/csv-dasboard/scripts/deploy-static-release.sh`

## 1) One-time Server Setup

Install prerequisites:

```bash
sudo apt update
sudo apt install -y nginx rsync
```

Create deploy directories:

```bash
sudo mkdir -p /var/www/csv-dashboard/releases
sudo chown -R "$USER":"$USER" /var/www/csv-dashboard
```

Install Nginx site config:

```bash
sudo cp /path/to/repo/deploy/nginx/csv-dashboard.conf /etc/nginx/sites-available/csv-dashboard.conf
sudo ln -sfn /etc/nginx/sites-available/csv-dashboard.conf /etc/nginx/sites-enabled/csv-dashboard.conf
sudo nginx -t
sudo systemctl reload nginx
```

Update `server_name` in the config to your real domain before enabling.

## 2) HTTPS (Recommended)

If your DNS already points to this VPS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d csvdash.com
```

Certbot usually installs automatic renewal.

## 3) Deploy a Release

### Option A: Deploy directly from checked-out repo

```bash
cd /path/to/repo
./scripts/deploy-static-release.sh --source ./app-web
```

### Option B: Deploy from a tarball artifact

```bash
./scripts/deploy-static-release.sh --source /tmp/csv-dashboard-web.tar.gz
```

Script behavior:

- Copies/extracts source into `/var/www/csv-dashboard/releases/<timestamp>`
- Verifies `index.html` exists
- Flips `/var/www/csv-dashboard/latest` symlink
- Runs `nginx -t` and reloads nginx
- Keeps last 8 releases by default

Useful flags:

- `--app-root /var/www/csv-dashboard`
- `--keep 12`
- `--no-nginx-reload`

## 4) Rollback

List available releases:

```bash
ls -1 /var/www/csv-dashboard/releases
```

Point `latest` back to a prior release and reload nginx:

```bash
ln -sfn /var/www/csv-dashboard/releases/<timestamp> /var/www/csv-dashboard/latest
sudo nginx -t && sudo systemctl reload nginx
```

## 5) Health Check

```bash
curl -I https://csvdash.com
```

Expect `200 OK` and content served from your latest release.
