#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/archive_logs_to_drive.sh
# Compresses AllMight logs and uploads to Google Drive via rclone.
# Keeps local compressed files 7 days. Drive keeps permanent history.
#
# Prerequisites:
#   sudo apt install rclone
#   rclone config  (name remote "gdrive", scope: drive.file)
#
# Cron: 0 2 * * * bash ~/Allmight/scripts/archive_logs_to_drive.sh
# ──────────────────────────────────────────────────────────────────────────────

REPO="$HOME/Allmight"
LOG_DIR="$REPO/logs"
STAGE_DIR="$LOG_DIR/upload_staging"
DRIVE_REMOTE="gdrive"
DRIVE_ROOT="AllMight/logs"
RETENTION_DAYS=7
DATE=$(date -u +%Y/%m/%d)
DATE_TAG=$(date -u +%Y%m%d)

mkdir -p "$STAGE_DIR"
echo "[archive] Starting -- $(date -u)"

# Check rclone
if ! command -v rclone &>/dev/null; then
    echo "[archive] ERROR: rclone not installed. Run: sudo apt install rclone"
    exit 1
fi
if ! rclone lsd "$DRIVE_REMOTE:" &>/dev/null; then
    echo "[archive] ERROR: rclone remote '$DRIVE_REMOTE' not configured."
    echo "  Run: rclone config"
    exit 1
fi

# Compress logs
for log in "$LOG_DIR"/*.log; do
    [[ -f "$log" ]] || continue
    name=$(basename "$log")
    dest="$STAGE_DIR/${name%.log}_${DATE_TAG}.log.gz"
    [[ $(wc -c < "$log") -lt 100 ]] && continue
    gzip -c "$log" > "$dest"
    echo "[archive] Compressed: $name -> $(du -h "$dest" | cut -f1)"
done

# Compress CSVs
for csv in "$LOG_DIR"/*.csv "$LOG_DIR/archive"/*.csv; do
    [[ -f "$csv" ]] || continue
    name=$(basename "$csv")
    dest="$STAGE_DIR/${name%.csv}_${DATE_TAG}.csv.gz"
    [[ -f "$dest" ]] && continue
    gzip -c "$csv" > "$dest"
    echo "[archive] Compressed: $name -> $(du -h "$dest" | cut -f1)"
done

# Upload to Drive
DRIVE_PATH="$DRIVE_REMOTE:$DRIVE_ROOT/$DATE"
echo "[archive] Uploading to $DRIVE_PATH"
rclone copy "$STAGE_DIR/" "$DRIVE_PATH/" \
    --transfers 4 --retries 3 --log-level ERROR \
    && echo "[archive] Upload complete" \
    || echo "[archive] Upload failed -- files staged at $STAGE_DIR"

# Clean local staging older than retention
find "$STAGE_DIR" -name "*.gz" -mtime +$RETENTION_DAYS -delete
echo "[archive] Cleaned staging > ${RETENTION_DAYS} days"

# Trim raw logs over 50MB (keep tail after archiving)
for log in "$LOG_DIR"/*.log; do
    [[ -f "$log" ]] || continue
    size=$(du -b "$log" | cut -f1)
    if [[ $size -gt 52428800 ]]; then
        tail -c 10485760 "$log" > "${log}.tmp" && mv "${log}.tmp" "$log"
        echo "[archive] Trimmed $(basename $log) to 10MB"
    fi
done

echo "[archive] Done -- $(date -u)"
