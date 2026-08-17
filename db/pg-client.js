// db/pg-client.js
//
// PostgreSQL connection pool for the relational data (LiveEvent, venues,
// artists, providers, and — from Step 8 onward — sports). Separate from
// persistence.js (DynamoDB/local-file, used for simple config blobs like
// provider credentials and price-watchers) — this is genuinely relational
// data and forcing it into DynamoDB would fight the tool.
//
// Set these env vars to activate it:
//   PG_HOST, PG_PORT (default 5432), PG_DATABASE, PG_USER, PG_PASSWORD
// Or a single PG_CONNECTION_STRING (postgres://user:pass@host:port/db) —
// if that's set, it takes priority over the individual vars.
//
// IMPORTANT: 'pg' is lazy-required inside getPool(), not at the top of this
// file. If it were required at the top, the ENTIRE server would crash on
// startup whenever the pg package isn't installed — even for routes that
// have nothing to do with the database (tickets, hotels, watchers, admin).
// This matches the same lazy-require pattern persistence.js already uses
// for the AWS SDK, for the same reason.

let pool = null;

function isConfigured() {
  return !!(process.env.PG_CONNECTION_STRING || process.env.PG_HOST);
}

function getPool() {
  if (pool) return pool;
  if (!isConfigured()) {
    throw new Error(
      'PostgreSQL is not configured. Set PG_CONNECTION_STRING, or PG_HOST/PG_DATABASE/PG_USER/PG_PASSWORD.'
    );
  }
  const { Pool } = require('pg'); // lazy — see note above
  if (process.env.PG_CONNECTION_STRING) {
    pool = new Pool({
      connectionString: process.env.PG_CONNECTION_STRING,
      ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false },
    });
  } else {
    pool = new Pool({
      host: process.env.PG_HOST,
      port: process.env.PG_PORT ? parseInt(process.env.PG_PORT, 10) : 5432,
      database: process.env.PG_DATABASE,
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

module.exports = { getPool, query, isConfigured };
