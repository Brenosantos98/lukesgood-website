# Luke’s Good · Lead dashboard

Mobile-first shared lead dashboard for Luke’s Good Exterior Cleaning, based in Acworth, Georgia. Intended address: `app.lukesgood.com`. The public marketing website at `lukesgood.com` is not included yet.

## Included

- Two separate team logins, shared D1 records, manual lead entry, search, assignments, notes and status tracking.
- Optimistic concurrency protection stops one partner silently overwriting the other’s changes. Dashboard refreshes every 20 seconds while visible.
- Installable iPhone web app with Web Push registration and notification click-through.
- Signed Meta lead webhook, Page allowlist, lead retrieval and duplicate protection.
- Persistent notification outbox, SMS through Twilio, Web Push through VAPID, and five-minute retries (five attempts maximum).
- Integration status and recent notification results. No sample leads, fake accounts, or placeholder delivery claims.

## Deployment status

Source only: NOT deployed, NOT connected to Meta, SMS or either phone. Requires a Cloudflare account, a D1 database, secrets, a sending number/provider approval and Meta permissions. Custom domain is not yet configured. Password recovery, lead deletion/export, quote pricing and a public estimate form are not implemented.

## Cloudflare setup

Use Node 22 or later. From this repository:

1. `npm install` (commit the generated package-lock.json after reviewing it).
2. `npx wrangler login`.
3. `npx wrangler d1 create lukesgood-leads`. Copy the returned database ID into `wrangler.jsonc`.
4. `npm run db:remote` to apply the checked-in schema.
5. `npm run setup` to create each partner’s login and VAPID keys locally. Password input is hidden; passwords are hashed, never written. The ignored `secrets.json` contains secret keys and hashed account records. Keep it private.
6. `npx wrangler secret bulk secrets.json`. Never paste secret values into chat or commit them.
7. `npm run deploy`.
8. In Cloudflare Workers → this Worker → Settings → Domains & Routes, add `app.lukesgood.com` as a Custom Domain. Keep your root domain available for the future public website. Confirm `APP_ORIGIN` matches the address you use.

For local development, apply `npm run db:local`, place equivalent secrets in ignored `.dev.vars`, then `npm run dev`. Login cookies require a secure context; use HTTPS for phone testing.

## Connect Meta

Configure Worker secrets using `npx wrangler secret put NAME`: `META_APP_SECRET`, `META_PAGE_TOKEN`, `META_PAGE_ID`, `META_VERIFY_TOKEN` (a fresh random value), and `META_GRAPH_VERSION` (a currently supported API version from your Meta app). Tokens require appropriate lead retrieval permissions and Page lead access; external app use may require Meta review and verification. A Page, Instagram account and ad account alone do not grant webhook access.

Set the Page webhook callback to `https://app.lukesgood.com/api/meta/webhook`, verify it with `META_VERIFY_TOKEN`, subscribe to `leadgen` and subscribe your app to the business Page. The server checks signatures before trusting any event and retrieves the lead server-side. Configure your Instant Form field keys as `full_name`, `phone_number`, `zip_code`, `services_needed`, `desired_timing`. Other question keys need mapping changes in `src/worker.js`. Publish a business-specific privacy policy before running the form. Treat customer information as private.

## Alerts to both partners

SMS: create/configure a Twilio sender, complete the applicable sender registration/verification, and set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`. Both partners must opt in to team alerts during local setup. SMS costs are separate from ad spend. Alerts go only to configured partners, never automatically to customers. Call/text buttons open the phone’s dialer or Messages app for manual customer follow-up.

Push: on each iPhone running iOS 16.4+, open the HTTPS app in Safari, Share → Add to Home Screen. Launch that installed app, sign in, and open Connections & alerts → Enable push. Repeat on the other phone. Permission requires a direct tap. Focus settings can silence alerts.

Outbox notes: a provider accepting an alert does not guarantee phone delivery. Requests use atomic claims to avoid concurrent duplicate sends. A Worker terminated during a send can leave a `sending` record requiring operator review; do not blindly retry these, because the provider may already have accepted it. Failed delivery never deletes the lead. The outbox can be inspected through the app and D1. Alert workers process up to 30 pending records per run. Changing a password hash does not revoke already-issued sessions; rotate SESSION_SECRET to sign everyone out if needed.

## Before advertising

- Run `npm test` and `npx wrangler deploy --dry-run` after dependency installation.
- Check both real logins, a manual lead, assignment, notes and simultaneous editing.
- Enable push separately on each iPhone, submit a manual lead and check both push and texts.
- Use Meta’s Lead Ads Testing Tool and verify customer fields, both alert channels and duplicate handling.
- Confirm retry failures are visible. Check declined notification permission and provider failures.
- Only then launch the approved $10/day campaign.

## Verification performed during initial development

See the development handoff for the checks actually run. A local test passing does not establish deployed D1, Meta, push or SMS functionality. Never launch ads based on source checks alone.
