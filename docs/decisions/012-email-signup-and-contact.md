# ADR 012: Email Signup and Contact Intake

## Status

Implemented

## Context

myRadOne needs a simple way to capture launch-interest emails from the public landing page without introducing a hosted form vendor or a heavier CRM stack before launch. The form collects marketing contact data, not medical images or clinical records, so the right design goal is lean ownership and clear consent rather than HIPAA-grade application complexity.

The existing landing experience is a static page in this repository. That means the intake path should work with the same lightweight deployment model, fit the current brand surface, and preserve flexibility while we are still pre-launch.

## Decision

We will collect signup emails through a small Cloudflare Worker backed by a D1 database, with the landing page posting to `https://api.myradone.com/subscribe`.

The landing page includes:

- An email field
- A required affirmative opt-in checkbox
- A privacy-policy link
- A Cloudflare Turnstile challenge to reduce automated abuse

The Worker stores only the minimum durable data needed to manage a list responsibly:

- `email`
- `status`
- `subscribed_at`
- `unsubscribed_at`
- `source`
- `consent_version`

## Alternatives Considered

### Hosted form services

Rejected for now. Tally, JotForm, and similar tools would get the job done quickly, but they add an extra vendor and push a core acquisition surface outside infrastructure we already control.

### Direct-to-newsletter SaaS signup

Rejected for now. Services like Buttondown, Beehiiv, or Kit may still be useful later for sending campaigns, but using them as the system of record now would make future data portability and consent auditing harder than necessary.

### No anti-abuse layer

Rejected. CORS alone does not stop direct POST spam. Turnstile provides a lightweight first line of defense without changing the owned-data model.

## Design Details

- The Worker lives in `workers/subscribe/` with its own `wrangler.toml`.
- The D1 schema is managed through committed migrations rather than one-off shell commands.
- Allowed origins are configurable, but the default list includes both `myradone.com` and `divergent.health` because the current landing artifact still uses the Divergent brand surface.
- The Worker treats a signup for an unsubscribed address as a reactivation instead of returning a duplicate success.
- The landing page ships with Cloudflare's visible Turnstile test site key by default so local testing works before production credentials are added.
- A static privacy page lives next to the landing page so the consent copy points to a real document immediately.

## Consequences

Positive:

- Full ownership of subscriber data
- No dependency on a third-party form embed
- Clear consent trail via `consent_version`
- Lower spam risk than an unprotected POST endpoint

Tradeoffs:

- Cloudflare setup is now part of the launch checklist
- We still need a separate outbound email system later
- Production launch requires replacing the test Turnstile site key and configuring the Worker custom domain
