// db/migrate.js
//
// Applies schema.sql to whatever PostgreSQL database is configured via env
// vars. Run with: npm run db:migrate
//
// Safe to run multiple times — every statement uses IF NOT EXISTS.

const fs = require('fs');
const path = require('path');
const { query, isConfigured } = require('./pg-client');

async function migrate() {
  if (!isConfigured()) {
    console.error(
      'PostgreSQL is not configured. Set PG_CONNECTION_STRING, or PG_HOST/PG_DATABASE/PG_USER/PG_PASSWORD, then re-run.'
    );
    process.exit(1);
  }

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  console.log('Applying schema.sql...');
  try {
    await query(schema);
    console.log('✓ Schema applied successfully.');
    process.exit(0);
  } catch (err) {
    console.error('✗ Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();
