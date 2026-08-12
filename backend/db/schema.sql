-- schema.sql — Step 7: "Introduce generic LiveEvent architecture" (Section 5).
--
-- Scope deliberately matches what Step 7 asks for, no further: the generic
-- LiveEvent entity plus what it needs to be meaningful (Venue, Artist,
-- Provider, Country). Sports (Team/League/Match) is Step 8, ticket/hotel
-- offers and price observations are Steps 9-10, checkout/orders are Steps
-- 11-12+ — those tables aren't here yet on purpose.
--
-- Every statement is idempotent (IF NOT EXISTS) — safe to re-run.

-- ============================================================
-- Reference data
-- ============================================================

CREATE TABLE IF NOT EXISTS countries (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(3) NOT NULL UNIQUE  -- ISO 3166-1
);

-- ============================================================
-- Providers — Section 22/61: every ticket/hotel/sports-data source is a
-- provider with declared capabilities (Section 21's ProviderCapabilities).
-- Populated here even though checkout capabilities (Steps 11-12) aren't
-- built yet, because the capability model itself belongs in the schema now
-- — provider adapters already exist in code (Ticketmaster, SeatGeek, etc.)
-- and this table is where their capabilities get declared, per Section 61's
-- explicit requirement that this be admin-configurable.
-- ============================================================

CREATE TABLE IF NOT EXISTS providers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  category VARCHAR(30) NOT NULL CHECK (category IN ('ticket','hotel','sports_data','email')),
  capabilities JSONB NOT NULL DEFAULT '{
    "search": false, "pricing": false, "availability": false,
    "affiliateRedirect": false, "embeddedCheckout": false, "directCheckout": false,
    "payment": false, "orderCreation": false, "cancellation": false, "refund": false
  }'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Venues — shared by every event type (Section 37), not concert-specific
-- ============================================================

CREATE TABLE IF NOT EXISTS venues (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  city VARCHAR(255),
  country_id INTEGER REFERENCES countries(id),
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  capacity INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Artists — the CONCERT-type specialization referenced by LiveEvent below.
-- (Team/League will be the SPORT-type specialization, added in Step 8.)
-- ============================================================

CREATE TABLE IF NOT EXISTS artists (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  genre VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- LiveEvent — Section 5's generic event architecture. This is the core
-- deliverable of Step 7.
--
--   LiveEvent
--   ├── Concert   (artist_id set)
--   ├── Sports Match  (match_id set — added in Step 8)
--   ├── Theatre  (event_type = 'THEATRE', no specialization table yet)
--   ├── Festival (event_type = 'FESTIVAL', no specialization table yet)
--   └── Other    (event_type = 'OTHER')
--
-- Exactly one of the type-specific FK columns should be set, matching
-- whichever event_type the row has. This lets every page, provider
-- lookup, and future ticket/hotel offer reference ONE canonical event
-- table regardless of what kind of event it actually is.
-- ============================================================

CREATE TABLE IF NOT EXISTS live_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('CONCERT','SPORT','THEATRE','FESTIVAL','OTHER')),
  slug VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  venue_id INTEGER REFERENCES venues(id),
  start_datetime TIMESTAMPTZ NOT NULL,
  end_datetime TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','finished','postponed','cancelled')),

  -- Type-specific specialization FK. artist_id is set when event_type =
  -- 'CONCERT'. A match_id column will be added here in Step 8 for SPORT —
  -- deliberately not added yet, since Team/Match don't exist until then.
  artist_id INTEGER REFERENCES artists(id),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Enforces the "exactly one specialization FK for the matching type" rule
  -- at the database level, not just in application code.
  CONSTRAINT live_events_type_consistency CHECK (
    (event_type = 'CONCERT' AND artist_id IS NOT NULL) OR
    (event_type != 'CONCERT' AND artist_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_live_events_type ON live_events(event_type);
CREATE INDEX IF NOT EXISTS idx_live_events_start ON live_events(start_datetime);
CREATE INDEX IF NOT EXISTS idx_live_events_venue ON live_events(venue_id);
CREATE INDEX IF NOT EXISTS idx_live_events_artist ON live_events(artist_id);
