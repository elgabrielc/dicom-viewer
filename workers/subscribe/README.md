# myRadOne Signup Worker

Cloudflare Worker + D1 for newsletter signup collection.

## Files

- `src/index.mjs` - Worker implementation
- `migrations/0001_create_subscribers.sql` - D1 schema
- `wrangler.toml` - Worker config

## Production setup

1. Create the D1 database:

   ```bash
   npx wrangler d1 create myradone-subscribers
   ```

2. Copy the returned `database_id` into `workers/subscribe/wrangler.toml`.

3. Apply the migration remotely:

   ```bash
   npx wrangler d1 migrations apply myradone-subscribers --remote --config workers/subscribe/wrangler.toml
   ```

4. Set the Turnstile secret:

   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY --config workers/subscribe/wrangler.toml
   ```

5. Deploy the Worker:

   ```bash
   npx wrangler deploy --config workers/subscribe/wrangler.toml
   ```

6. Add a custom domain in Cloudflare:

   - Worker: `myradone-subscribe`
   - Domain: `api.myradone.com`
   - Path: `/subscribe`

7. Replace the test Turnstile site key in `design/brand/landing.html` with the production site key before launch.

## Local testing

Create `workers/subscribe/.dev.vars` with the Turnstile test secret:

```dotenv
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

Then run:

```bash
npx wrangler dev --config workers/subscribe/wrangler.toml
```

The landing page currently uses Cloudflare's visible test site key by default so the signup flow can be exercised locally without production credentials.
