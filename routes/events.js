// routes/events.js
//
// HTTP-facing handlers for the generic LiveEvent model. Deliberately
// type-agnostic — /api/events returns concerts today, and (from Step 8)
// sports matches too, through the exact same endpoint.

const liveEventQueries = require('../db/queries/liveEvents');

async function listUpcomingEvents(query) {
  const limit = query.limit ? parseInt(query.limit, 10) : 20;
  const events = await liveEventQueries.getUpcomingEvents(limit);
  return { count: events.length, results: events };
}

async function getEvent(slug) {
  const event = await liveEventQueries.getEventBySlug(slug);
  if (!event) {
    throw Object.assign(new Error('Event not found'), { statusCode: 404 });
  }
  return { event };
}

async function listEventsByType(eventType, query) {
  const limit = query.limit ? parseInt(query.limit, 10) : 20;
  const events = await liveEventQueries.getEventsByType(eventType.toUpperCase(), limit);
  return { count: events.length, results: events };
}

async function listEventsByArtist(artistSlug) {
  const events = await liveEventQueries.getEventsByArtist(artistSlug);
  return { count: events.length, results: events };
}

async function listEventsByVenue(venueSlug) {
  const events = await liveEventQueries.getEventsByVenue(venueSlug);
  return { count: events.length, results: events };
}

module.exports = { listUpcomingEvents, getEvent, listEventsByType, listEventsByArtist, listEventsByVenue };
