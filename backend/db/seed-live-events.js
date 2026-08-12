// db/seed-live-events.js
//
// Loads the existing 6 concert events (db/seed-data/concerts.js) into the
// new live_events table, proving Section 5's requirement that existing
// concert data maps cleanly into the generic LiveEvent model.
//
// Run with: npm run db:seed-events
// Idempotent — ON CONFLICT (slug) DO UPDATE, safe to re-run.

const { query, isConfigured } = require('./pg-client');
const { COUNTRIES, VENUES, ARTISTS, EVENTS } = require('./seed-data/concerts');

async function upsertCountry(c) {
  const result = await query(
    `INSERT INTO countries (name, code) VALUES ($1, $2)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [c.name, c.code]
  );
  return result.rows[0].id;
}

async function upsertVenue(v, countryId) {
  const result = await query(
    `INSERT INTO venues (name, slug, city, country_id, latitude, longitude)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name, city = EXCLUDED.city, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
     RETURNING id`,
    [v.name, v.slug, v.city, countryId, v.lat, v.lng]
  );
  return result.rows[0].id;
}

async function upsertArtist(a) {
  const result = await query(
    `INSERT INTO artists (name, slug) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [a.name, a.slug]
  );
  return result.rows[0].id;
}

async function upsertLiveEvent(e, artistId, venueId) {
  await query(
    `INSERT INTO live_events (event_type, slug, name, venue_id, start_datetime, artist_id)
     VALUES ('CONCERT', $1, $2, $3, $4, $5)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name, venue_id = EXCLUDED.venue_id, start_datetime = EXCLUDED.start_datetime, artist_id = EXCLUDED.artist_id`,
    [e.slug, e.name, venueId, e.startDatetime, artistId]
  );
}

async function seed() {
  if (!isConfigured()) {
    console.error('PostgreSQL is not configured. Set PG_CONNECTION_STRING or PG_HOST/etc, then re-run.');
    process.exit(1);
  }

  console.log('Seeding LiveEvent data from the existing concert lineup...');

  const countryIdByCode = {};
  for (const c of COUNTRIES) countryIdByCode[c.code] = await upsertCountry(c);

  const venueIdBySlug = {};
  for (const v of VENUES) venueIdBySlug[v.slug] = await upsertVenue(v, countryIdByCode[v.countryCode]);

  const artistIdBySlug = {};
  for (const a of ARTISTS) artistIdBySlug[a.slug] = await upsertArtist(a);

  for (const e of EVENTS) {
    await upsertLiveEvent(e, artistIdBySlug[e.artistSlug], venueIdBySlug[e.venueSlug]);
  }

  console.log(`✓ Seeded: ${COUNTRIES.length} countries, ${VENUES.length} venues, ${ARTISTS.length} artists, ${EVENTS.length} live events.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('✗ Seeding failed:', err.message);
  process.exit(1);
});
