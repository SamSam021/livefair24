// db/queries/liveEvents.js
//
// Read-only queries against the generic live_events table. Deliberately
// type-agnostic where possible — getUpcomingEvents() returns concerts AND
// (from Step 8 onward) sports matches through the same query, since that's
// the entire point of the generic LiveEvent model (Section 3: one
// underlying ecosystem regardless of entry point).

const { query } = require('../pg-client');

async function getUpcomingEvents(limit = 20) {
  const result = await query(
    `SELECT le.id, le.event_type, le.slug, le.name, le.start_datetime, le.status,
            v.name AS venue_name, v.slug AS venue_slug, v.city, v.latitude, v.longitude,
            a.name AS artist_name, a.slug AS artist_slug
     FROM live_events le
     LEFT JOIN venues v ON v.id = le.venue_id
     LEFT JOIN artists a ON a.id = le.artist_id
     WHERE le.start_datetime >= now()
       AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL
     ORDER BY le.start_datetime ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function getEventBySlug(slug) {
  const result = await query(
    `SELECT le.id, le.event_type, le.slug, le.name, le.start_datetime, le.end_datetime, le.status,
            v.id AS venue_id, v.name AS venue_name, v.slug AS venue_slug, v.city, v.latitude, v.longitude, v.capacity,
            a.id AS artist_id, a.name AS artist_name, a.slug AS artist_slug
     FROM live_events le
     LEFT JOIN venues v ON v.id = le.venue_id
     LEFT JOIN artists a ON a.id = le.artist_id
     WHERE le.slug = $1
       AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL`,
    [slug]
  );
  return result.rows[0] || null;
}

async function getEventsByType(eventType, limit = 20) {
  const result = await query(
    `SELECT le.id, le.event_type, le.slug, le.name, le.start_datetime, le.status,
            v.name AS venue_name, v.slug AS venue_slug, v.city,
            a.name AS artist_name, a.slug AS artist_slug
     FROM live_events le
     LEFT JOIN venues v ON v.id = le.venue_id
     LEFT JOIN artists a ON a.id = le.artist_id
     WHERE le.event_type = $1 AND le.start_datetime >= now()
       AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL
     ORDER BY le.start_datetime ASC
     LIMIT $2`,
    [eventType, limit]
  );
  return result.rows;
}

async function getEventsByArtist(artistSlug, limit = 20) {
  const result = await query(
    `SELECT le.id, le.slug, le.name, le.start_datetime, le.status,
            v.name AS venue_name, v.city
     FROM live_events le
     JOIN artists a ON a.id = le.artist_id
     LEFT JOIN venues v ON v.id = le.venue_id
     WHERE a.slug = $1 AND le.start_datetime >= now()
       AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL
     ORDER BY le.start_datetime ASC
     LIMIT $2`,
    [artistSlug, limit]
  );
  return result.rows;
}

async function getEventsByVenue(venueSlug, limit = 20) {
  const result = await query(
    `SELECT le.id, le.event_type, le.slug, le.name, le.start_datetime, le.status,
            a.name AS artist_name, a.slug AS artist_slug
     FROM live_events le
     JOIN venues v ON v.id = le.venue_id
     LEFT JOIN artists a ON a.id = le.artist_id
     WHERE v.slug = $1 AND le.start_datetime >= now()
       AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL
     ORDER BY le.start_datetime ASC
     LIMIT $2`,
    [venueSlug, limit]
  );
  return result.rows;
}

module.exports = { getUpcomingEvents, getEventBySlug, getEventsByType, getEventsByArtist, getEventsByVenue };
