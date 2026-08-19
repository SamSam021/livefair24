// lib/concertGenreBuckets.js
//
// Maps Ticketmaster's real "genre" classification (the middle level of
// their documented segment -> genre -> subGenre hierarchy, e.g. "Rock",
// "Hip-Hop/Rap", "Country" under the Music segment) into the small set
// of user-facing categories the /concerts/ menu shows.
//
// IMPORTANT — this mapping is built from Ticketmaster's public API
// documentation (their classifications endpoint / discovery docs), not
// from a live-verified dump of every genre value their system actually
// returns. The Music segment's genre list is fairly stable and these are
// the standard values documented and commonly observed, but this has NOT
// been checked against a real response from this project's own API key.
// Before relying on this in production: hit
// https://app.ticketmaster.com/discovery/v2/classifications.json with
// your real key, or just log `ev.musicGenre` for a week of real search
// results and confirm every value below actually appears, and add any
// that don't. Anything that doesn't match falls into "Other" rather than
// being dropped or guessed at.

const BUCKETS = [
  { key: 'rap-hiphop', label: 'Rap / Hip Hop' },
  { key: 'pop-rock', label: 'Pop / Rock' },
  { key: 'country-folk', label: 'Country / Folk' },
  { key: 'techno-electronic', label: 'Techno / Electronic' },
  { key: 'festivals', label: 'Music Festivals' },
  { key: 'other', label: 'Other' },
];

// Ticketmaster genre.name (lowercased) -> bucket key.
const GENRE_TO_BUCKET = {
  'hip-hop/rap': 'rap-hiphop',
  'hip hop': 'rap-hiphop',
  'rap': 'rap-hiphop',
  'r&b': 'rap-hiphop',

  'rock': 'pop-rock',
  'pop': 'pop-rock',
  'alternative': 'pop-rock',
  'indie': 'pop-rock',
  'metal': 'pop-rock',
  'punk': 'pop-rock',

  'country': 'country-folk',
  'folk': 'country-folk',
  'americana': 'country-folk',
  'blues': 'country-folk',

  'dance/electronic': 'techno-electronic',
  'dance': 'techno-electronic',
  'electronic': 'techno-electronic',
  'edm': 'techno-electronic',
  'house': 'techno-electronic',
  'techno': 'techno-electronic',

  'festival': 'festivals',
  'music festival': 'festivals',
};

function bucketForGenre(genreName) {
  if (!genreName) return 'other';
  const key = String(genreName).trim().toLowerCase();
  return GENRE_TO_BUCKET[key] || 'other';
}

module.exports = { BUCKETS, bucketForGenre };
