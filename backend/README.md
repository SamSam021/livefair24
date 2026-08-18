# LiveFair24 backend

Zero-dependency Node.js server. It does two things:
1. Serves the static frontend from `../seo-site`
2. Exposes `/api/tickets` and `/api/hotels`, which aggregate whichever
   provider APIs you've configured (or fall back to clearly-labeled demo
   data if you haven't configured any yet)

## Run it locally

```
cd backend
node server.js
```

Open http://localhost:3000 — the whole site runs, in demo mode, with zero
setup. No `npm install` needed (no dependencies).

## Add a real ticket or hotel source

Two ways to do this — pick whichever is easier for you:

**Option A — the admin panel (recommended):**
1. Run the server, go to `http://localhost:3000/admin` (or your deployed URL + `/admin`)
2. Log in with the password from `ADMIN_PASSWORD` (or the temporary one printed in the server log if you haven't set one)
3. Paste in the key(s) for a built-in provider (Ticketmaster, SeatGeek, Amadeus, Hotelbeds) and hit Save, or use "+ Add a new ticket/hotel provider" to register one that isn't built in yet
4. It's live immediately — no restart, no redeploy

**Option B — environment variables:**
1. Copy `.env.example` to `.env`
2. Fill in the key(s) for whichever provider(s) you have
3. Restart the server

Either way, the site automatically starts using that provider and drops out
of demo mode. Admin-panel values and `.env` values can both be set — the
admin panel wins if both are present for the same key.

### Adding a provider that has no dedicated adapter yet

The "+ Add a new provider" form in the admin panel works for simple REST
APIs: give it a base URL, how the API key is sent (query param or header),
the search-term param name, and dot-paths to pull the seller name / price /
link out of each result. This covers a lot of ticket/hotel APIs without any
code.

It does **not** cover OAuth token flows, multi-step booking APIs, or unusual
auth (Amadeus and Hotelbeds are both examples of that — that's why they have
real adapter files instead of being left to the generic connector). For
those, copy `providers/tickets/demo.js` or `providers/hotels/demo.js` as a
template and write a proper adapter — see the next section.

### Adding a provider by writing an adapter file (for complex APIs)

1. Copy `providers/tickets/demo.js` or `providers/hotels/demo.js` as a
   starting template
2. Rename it, implement `isEnabled()` and `search()` for the real API
3. Add its required env var(s) to `.env.example` — this also makes it show
   up automatically in the admin panel's built-in provider list, since that
   list is generated from each adapter's `requiredEnv`

Nothing else needs to change — `providers/registry.js` auto-discovers every
file in those two folders.

**⚠️ Before trusting any of the four built-in real adapters in production:**
they were written from each provider's documented API conventions, not
tested against a live key — this sandbox has no outbound internet access,
so I couldn't call the real endpoints to verify them. Test each one with
your actual key and compare the response against that provider's current
docs before launching:
- Ticketmaster: https://developer.ticketmaster.com/
- SeatGeek: https://platform.seatgeek.com/
- Amadeus: https://developers.amadeus.com/
- Hotelbeds: https://developer.hotelbeds.com/

Field names and auth details do drift over time, and estimated-fee logic in
the ticket adapters (marked in comments) is a placeholder until you confirm
what each provider actually exposes.

## Add a provider that isn't built in yet

1. Copy `providers/tickets/demo.js` or `providers/hotels/demo.js` as a
   starting template
2. Rename it, implement `isEnabled()` and `search()` for the real API
3. Add its required env var(s) to `.env.example`

Nothing else needs to change — `providers/registry.js` auto-discovers every
file in those two folders.

## Storage: local file vs. DynamoDB

Everything the admin panel manages (provider keys, custom providers) and
every price-alert signup is stored durably. Which backend is used is
decided automatically:

- **`DYNAMODB_TABLE` not set** → stored in `backend/data/*.json`. Simplest
  option, zero AWS setup, works great for local development.
- **`DYNAMODB_TABLE` set** → stored in DynamoDB. **Use this for App Runner**
  (or any host without a persistent local disk) — without it, everything
  you enter through the admin panel and every price-alert signup is lost
  the moment the container restarts or redeploys.

### Setting up the DynamoDB table (one-time, in the AWS Console)

1. Go to **DynamoDB → Tables → Create table**
2. Table name: anything (e.g. `livefair24-app-data`) — this is the value
   you'll set as `DYNAMODB_TABLE`
3. Partition key: `id`, type **String**
4. Everything else can stay default (on-demand capacity mode is fine for
   this — it's a low-write-volume config store, not transactional data)

### Giving App Runner permission to use it

1. **IAM → Roles → Create role** → trusted entity: **App Runner** → attach
   a policy that allows `dynamodb:GetItem` and `dynamodb:PutItem` on your
   table's ARN (a minimal custom policy is better here than the broad
   `AmazonDynamoDBFullAccess` managed policy)
2. In your App Runner service's configuration, set this role as the
   **Instance role** (not the "access role," which is a different thing
   used only for pulling from ECR)
3. With the instance role attached, the AWS SDK picks up temporary
   credentials automatically — you never need to put an AWS access key or
   secret in an environment variable

### Verifying it before you fully rely on it

This DynamoDB code path was written from documented SDK v3 conventions, not
tested against a live table — this sandbox has no outbound network access.
Before trusting it in production: deploy with `DYNAMODB_TABLE` set, log into
`/admin`, save a test credential, then check the DynamoDB console directly
to confirm an item with `id: "provider-config"` actually appears in your
table.

## Deploying to AWS App Runner (step by step)

I can't do this step for you — I'm running in a sandbox with no outbound
network access and no way to touch your AWS account. Here's exactly what to
do:

1. **Push this whole project to a GitHub repo** — `seo-site/`, `backend/`,
   and `apprunner.yaml` all at the top level, as they are in this zip. The
   `.gitignore` already excludes `.env` and `backend/data/` so no secrets
   end up in git.
2. **Set up the DynamoDB table and IAM instance role** — see the section
   above. Do this before creating the App Runner service so you have the
   role ready to attach.
3. **AWS Console → App Runner → Create service**
   - Source: **Source code repository** → connect your GitHub account →
     pick this repo and branch
   - Deployment trigger: automatic (so future pushes redeploy automatically)
   - Build settings: it should auto-detect `apprunner.yaml` at the repo
     root — if it offers a "configuration file" vs "manual configuration"
     choice, pick **configuration file**
4. **Configuration → Environment variables** — add `ADMIN_PASSWORD` at
   minimum, `DYNAMODB_TABLE` (and `AWS_REGION` if not us-east-1), plus any
   provider keys you already have. You can add more later without
   redeploying — either back here in App Runner's env var settings (needs a
   redeploy) or through `/admin` once it's live (no redeploy needed)
5. **Configuration → Security → Instance role** — attach the IAM role you
   created in step 2
6. **Create & deploy** — takes a few minutes. App Runner gives you an HTTPS
   URL immediately (`https://xxxx.awsapprunner.com`) — that's enough to
   consider the site "live" today, even before pointing a custom domain at
   it
7. **Custom domain (optional, can do later)** — App Runner → your service →
   **Custom domains** → add your domain → it gives you DNS records to add
   at your registrar

**Before you consider this live: set `ADMIN_PASSWORD` in step 4.** Without
it, a random password is generated each time the container starts and only
shown in the (App Runner) application log — not something to rely on once
this is public. Also don't link to `/admin` from anywhere on the public
site.

## Deploying elsewhere (Render, Railway, Fly.io)

If you'd rather not use AWS, the same repo works on any host that runs a
persistent Node process — those have a real local disk, so you can skip the
DynamoDB setup entirely and just leave `DYNAMODB_TABLE` unset:

1. Push to a git repo (as above)
2. Connect the repo — these hosts detect `npm start` automatically
3. Set `ADMIN_PASSWORD` and provider keys as environment variables
4. Point your domain's DNS at the host once you're ready — the platform's
   own URL (`*.onrender.com` etc.) is enough to be "live" in the meantime

## What still isn't real yet

Buying a ticket or booking a hotel through this site doesn't actually work —
"Get tickets" and "Book" links point to whatever URL the provider's API
returns (or `#` in demo mode). Real ticket/hotel purchases happen on the
seller's own site; this app only compares and links out. If you want actual
affiliate revenue, you'll need to sign up for each seller's affiliate
program and use your affiliate link format in place of the raw seller URL.

## Price-drop alerts

Visitors can sign up on an event page to get emailed if the price drops.
How it works, end to end:

1. "Notify me if this drops" form on the event page → `POST /api/watchers`
2. Stored in `data/watchers.json` (gitignored — contains real emails)
3. A scheduled job (`price-check.js`) re-checks every watched event once an
   hour, using the same `/api/tickets` aggregation the site already has
4. If the price is lower than what the person was last told, it emails them
   via whichever email provider is configured (or logs it, in demo mode)
5. Every email includes an unsubscribe link — `GET /unsubscribe?id=&token=`

**To send real emails:** add `SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL`, or
`RESEND_API_KEY` + `RESEND_FROM_EMAIL`, either in `.env` or the admin panel.
Same caveat as the ticket/hotel adapters — written from documented API
conventions, not tested against a live key in this sandbox. Verify against
each provider's docs (linked in the admin panel and in the adapter files)
before relying on it.

**Without a real key**, alerts still work completely — they just get logged
instead of sent, visible in the admin panel under "Recent alert emails."
That's genuinely useful for testing the whole flow (signup → price check →
notification → unsubscribe) before you have an email provider account.

**Admin panel additions for this feature:**
- See how many people are watching each event
- "Run price check now" — trigger a check on demand instead of waiting for
  the hourly schedule (handy for testing)
- The demo email log

**One limitation worth knowing:** the scheduler (`setInterval` in
`server.js`) only runs while the Node process is alive. Some serverless
hosts spin your process down when it's idle, which would silently stop the
hourly check. If you deploy somewhere serverless, you'll want to trigger
`POST /admin/api/run-price-check` from an external cron service (e.g. a
free cron-job.org ping) instead of relying on the in-process interval. A
host that keeps a persistent process running (Render, Railway, a VPS)
doesn't have this problem.
