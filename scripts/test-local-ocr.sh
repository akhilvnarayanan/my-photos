#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${MY_PHOTOS_TEST_URL:-http://127.0.0.1:8080}"
: "${MY_PHOTOS_USERNAME:?Set MY_PHOTOS_USERNAME before running this test}"
: "${MY_PHOTOS_PASSWORD:?Set MY_PHOTOS_PASSWORD before running this test}"
: "${DATABASE_URL:?Set DATABASE_URL before running this test}"

cookie_file="$(mktemp)"
fixture_dir="$(mktemp -d)"
photo_id=""
import_id=""

cleanup() {
  if [[ -n "$photo_id" ]]; then
    curl -fsS -b "$cookie_file" -X DELETE "$BASE_URL/api/photos/$photo_id" -o /dev/null || true
    curl -fsS -b "$cookie_file" -X DELETE "$BASE_URL/api/photos/$photo_id/permanent" -o /dev/null || true
  fi
  rm -rf "$fixture_dir" "$cookie_file"
}
trap cleanup EXIT

convert -size 1400x500 xc:white -fill black -gravity center -font DejaVu-Sans \
  -pointsize 82 -annotate 0 'LOCAL OCR 12345' "$fixture_dir/ocr-fixture.png"

login_payload="$(jq -n \
  --arg username "$MY_PHOTOS_USERNAME" \
  --arg password "$MY_PHOTOS_PASSWORD" \
  '{username: $username, password: $password}')"
curl -fsS -c "$cookie_file" -H 'Content-Type: application/json' \
  -d "$login_payload" "$BASE_URL/api/auth/session" >/dev/null

pause_status="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/ai/status")"
[[ "$pause_status" == "401" ]] || { echo "Expected unauthenticated AI status to return 401" >&2; exit 1; }

import_id="$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg path "$fixture_dir" '{sourcePath: $path, sourceType: "LOCAL_FOLDER"}')" \
  "$BASE_URL/api/imports" | jq -r '.id')"
curl -fsS -b "$cookie_file" -X POST "$BASE_URL/api/imports/$import_id/confirm" >/dev/null

for _ in $(seq 1 90); do
  import_status="$(curl -fsS -b "$cookie_file" "$BASE_URL/api/imports/$import_id" | jq -r '.status')"
  [[ "$import_status" == "completed" ]] && break
  [[ "$import_status" == "failed" || "$import_status" == "cancelled" ]] && {
    echo "Import ended in $import_status" >&2
    exit 1
  }
  sleep 1
done
[[ "$import_status" == "completed" ]] || { echo "Import did not complete" >&2; exit 1; }

curl -fsS -b "$cookie_file" -X POST "$BASE_URL/api/ai/pause" >/dev/null
paused="$(curl -fsS -b "$cookie_file" "$BASE_URL/api/ai/status" | jq -r '.settings.processingPaused')"
[[ "$paused" == "true" ]] || { echo "AI pause did not persist" >&2; exit 1; }
curl -fsS -b "$cookie_file" -X POST "$BASE_URL/api/ai/resume" >/dev/null
resumed="$(curl -fsS -b "$cookie_file" "$BASE_URL/api/ai/status" | jq -r '.settings.processingPaused')"
[[ "$resumed" == "false" ]] || { echo "AI resume did not persist" >&2; exit 1; }

for _ in $(seq 1 90); do
  ai_status="$(curl -fsS -b "$cookie_file" "$BASE_URL/api/ai/status")"
  queued="$(jq -r '.queued' <<<"$ai_status")"
  processing="$(jq -r '.processing' <<<"$ai_status")"
  completed="$(jq -r '.completed' <<<"$ai_status")"
  failed="$(jq -r '.failed' <<<"$ai_status")"
  [[ "$processing" == "0" && "$queued" == "0" ]] && break
  sleep 1
done
[[ "$completed" -gt 0 && "$failed" == "0" ]] || {
  echo "OCR did not complete successfully: $ai_status" >&2
  exit 1
}

search_result="$(curl -fsS -b "$cookie_file" --get --data-urlencode 'query=12345' "$BASE_URL/api/photos")"
photo_id="$(jq -r '.items[0].id // empty' <<<"$search_result")"
[[ -n "$photo_id" ]] || { echo "OCR text was not searchable" >&2; exit 1; }

ocr_text="$(psql "$DATABASE_URL" -Atc "select text from photo_text where photo_id = '$photo_id'")"
[[ "$ocr_text" == *"LOCAL OCR 12345"* ]] || { echo "Unexpected OCR text: $ocr_text" >&2; exit 1; }

job_count="$(psql "$DATABASE_URL" -Atc "select count(*) from ai_jobs where photo_id = '$photo_id' and feature = 'OCR'")"
[[ "$job_count" == "1" ]] || { echo "Expected one unique OCR job, found $job_count" >&2; exit 1; }

echo "Local OCR smoke test passed: imported, processed, persisted, searched, paused/resumed, and cleaned up."