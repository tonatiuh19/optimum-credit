#!/usr/bin/env bash
# Apply pending database migrations to TiDB Cloud (reads credentials from .env).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "❌ .env not found at $ROOT/.env"
  exit 1
fi

DB_PASS=$(grep "^DB_PASSWORD" .env | cut -d'=' -f2-)
DB_HOST=$(grep "^DB_HOST" .env | cut -d'=' -f2-)
DB_PORT=$(grep "^DB_PORT" .env | cut -d'=' -f2-)
DB_USER=$(grep "^DB_USER" .env | cut -d'=' -f2-)
DB_NAME=$(grep "^DB_NAME" .env | cut -d'=' -f2-)

MYSQL=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME"
  --ssl-mode=REQUIRED --protocol=TCP)

run_migration() {
  local file="$1"
  echo ""
  echo "▶ Applying $(basename "$file") ..."
  if "${MYSQL[@]}" < "$file" 2>&1; then
    echo "✅ $(basename "$file")"
  else
    echo "⚠️  $(basename "$file") failed — may already be partially applied."
    echo "   Check errors above; re-run verification below."
  fi
}

echo "🔍 Checking current schema ..."
"${MYSQL[@]}" -e "
  SELECT
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'packages'
       AND COLUMN_NAME = 'checkout_type') AS has_checkout_type,
    (SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tradeline_products') AS has_tradeline_products;
"

# Pricing + tradeline catalog (required for prod payments)
run_migration "database/migrations/20260528_120000_update_packages_ofg_pricing.sql"
run_migration "database/migrations/20260529_120000_tradeline_catalog_and_subscriptions.sql"
run_migration "database/migrations/20260704_120000_update_standard_complex_features.sql"
run_migration "database/migrations/20260704_180000_report_wizard.sql"
run_migration "database/migrations/20260704_190000_task_completions_case_scope.sql"
run_migration "database/migrations/20260717_120000_legal_documents.sql"

# Optional: remove test/dev client records (edit WHERE clause in file before running)
if [[ "${1:-}" == "--cleanup" ]]; then
  run_migration "database/migrations/20260430_000000_cleanup_test_clients.sql"
fi

echo ""
echo "🔍 Verifying packages & tradelines ..."
"${MYSQL[@]}" -e "
  SELECT slug, price_cents, compare_price_cents, billing_interval, checkout_type, is_active
  FROM packages ORDER BY sort_order;
  SELECT COUNT(*) AS tradeline_product_count FROM tradeline_products;
"

echo ""
echo "🎉 Done."
