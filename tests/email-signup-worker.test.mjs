import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SUBSCRIBE_PATH,
    handleSubscribe,
    isValidEmail,
    normalizeEmail,
    parseAllowedOrigins
} from '../workers/subscribe/src/index.mjs';

function createDb(initialSubscribers = []) {
    const subscribers = new Map(
        initialSubscribers.map((subscriber) => [subscriber.email, { ...subscriber }])
    );

    return {
        subscribers,
        prepare(query) {
            return {
                args: [],
                bind(...args) {
                    this.args = args;
                    return this;
                },
                async first() {
                    if (query.startsWith('SELECT status FROM subscribers')) {
                        const email = this.args[0];
                        const subscriber = subscribers.get(email);
                        return subscriber ? { status: subscriber.status } : null;
                    }

                    throw new Error(`Unhandled first() query: ${query}`);
                },
                async run() {
                    if (query.startsWith('INSERT INTO subscribers')) {
                        const [email, source, consentVersion] = this.args;
                        subscribers.set(email, {
                            email,
                            status: 'active',
                            source,
                            consentVersion,
                            unsubscribedAt: null
                        });
                        return { success: true };
                    }

                    if (query.startsWith("UPDATE subscribers SET status = 'active'")) {
                        const [source, consentVersion, email] = this.args;
                        const subscriber = subscribers.get(email);
                        subscribers.set(email, {
                            ...subscriber,
                            status: 'active',
                            source,
                            consentVersion,
                            unsubscribedAt: null
                        });
                        return { success: true };
                    }

                    throw new Error(`Unhandled run() query: ${query}`);
                }
            };
        }
    };
}

function createEnv(overrides = {}) {
    return {
        ALLOWED_ORIGINS: 'https://myradone.com,https://divergent.health',
        TURNSTILE_SECRET_KEY: 'test-secret',
        DB: createDb(),
        ...overrides
    };
}

function createVerificationFetch(payload = { success: true }) {
    return async function fetchMock(url) {
        assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
        return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };
}

function createRateLimiter(success = true) {
    return {
        calls: [],
        async limit({ key }) {
            this.calls.push(key);
            return { success };
        }
    };
}

test('helpers normalize and validate email input', () => {
    assert.equal(normalizeEmail('  DOCTOR@Example.COM '), 'doctor@example.com');
    assert.equal(isValidEmail('doctor@example.com'), true);
    assert.equal(isValidEmail('not-an-email'), false);
    assert.deepEqual(
        [...parseAllowedOrigins('https://myradone.com, https://divergent.health')],
        ['https://myradone.com', 'https://divergent.health']
    );
});

test('creates a new subscriber when the request is valid', async () => {
    const env = createEnv();
    const request = new Request(`https://api.myradone.com${SUBSCRIBE_PATH}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: 'https://myradone.com'
        },
        body: JSON.stringify({
            email: 'doctor@example.com',
            turnstileToken: 'token',
            source: 'landing',
            consentVersion: 'v1',
            consentAccepted: true
        })
    });

    const response = await handleSubscribe(request, env, createVerificationFetch());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(env.DB.subscribers.get('doctor@example.com').status, 'active');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://myradone.com');
});

test('returns already for active subscribers', async () => {
    const env = createEnv({
        DB: createDb([
            {
                email: 'doctor@example.com',
                status: 'active',
                source: 'landing',
                consentVersion: 'v1'
            }
        ])
    });

    const request = new Request(`https://api.myradone.com${SUBSCRIBE_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'doctor@example.com',
            turnstileToken: 'token',
            source: 'landing',
            consentVersion: 'v1',
            consentAccepted: true
        })
    });

    const response = await handleSubscribe(request, env, createVerificationFetch());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true });
});

test('reactivates unsubscribed subscribers', async () => {
    const env = createEnv({
        DB: createDb([
            {
                email: 'doctor@example.com',
                status: 'unsubscribed',
                source: 'landing',
                consentVersion: 'v1'
            }
        ])
    });

    const request = new Request(`https://api.myradone.com${SUBSCRIBE_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'doctor@example.com',
            turnstileToken: 'token',
            source: 'demo',
            consentVersion: 'v2',
            consentAccepted: true
        })
    });

    const response = await handleSubscribe(request, env, createVerificationFetch());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(env.DB.subscribers.get('doctor@example.com').source, 'demo');
    assert.equal(env.DB.subscribers.get('doctor@example.com').consentVersion, 'v2');
});

test('rejects missing Turnstile token without calling siteverify', async () => {
    const env = createEnv();
    let fetchCalled = false;

    const missingToken = await handleSubscribe(
        new Request(`https://api.myradone.com${SUBSCRIBE_PATH}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'doctor@example.com',
                consentAccepted: true
            })
        }),
        env,
        async () => {
            fetchCalled = true;
            throw new Error('siteverify should not be called without a token');
        }
    );
    assert.equal(missingToken.status, 403);
    assert.equal(fetchCalled, false);
});

test('rejects invalid email and missing consent', async () => {
    const env = createEnv();

    const invalidEmail = await handleSubscribe(
        new Request(`https://api.myradone.com${SUBSCRIBE_PATH}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'bad-email',
                turnstileToken: 'token',
                consentAccepted: true
            })
        }),
        env,
        createVerificationFetch()
    );
    assert.equal(invalidEmail.status, 400);

    const missingConsent = await handleSubscribe(
        new Request(`https://api.myradone.com${SUBSCRIBE_PATH}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'doctor@example.com',
                turnstileToken: 'token',
                consentAccepted: false
            })
        }),
        env,
        createVerificationFetch()
    );
    assert.equal(missingConsent.status, 400);
});

test('handles CORS and disallowed origins', async () => {
    const env = createEnv();

    const preflight = await handleSubscribe(
        new Request(`https://api.myradone.com${SUBSCRIBE_PATH}`, {
            method: 'OPTIONS',
            headers: { Origin: 'https://divergent.health' }
        }),
        env,
        createVerificationFetch()
    );
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://divergent.health');

    const blocked = await handleSubscribe(
        new Request(`https://api.myradone.com${SUBSCRIBE_PATH}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://evil.example'
            },
            body: JSON.stringify({
                email: 'doctor@example.com',
                turnstileToken: 'token',
                consentAccepted: true
            })
        }),
        env,
        createVerificationFetch()
    );
    assert.equal(blocked.status, 403);
});

test('allows preflight from disallowed origins without granting CORS', async () => {
    const env = createEnv();

    const preflight = await handleSubscribe(
        new Request(`https://api.myradone.com${SUBSCRIBE_PATH}`, {
            method: 'OPTIONS',
            headers: { Origin: 'https://evil.example' }
        }),
        env,
        createVerificationFetch()
    );

    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), null);
});

test('rate limits excessive requests before siteverify and storage', async () => {
    const rateLimiter = createRateLimiter(false);
    const env = createEnv({
        SUBSCRIBE_RATE_LIMIT: rateLimiter
    });
    let fetchCalled = false;

    const response = await handleSubscribe(
        new Request(`https://api.myradone.com${SUBSCRIBE_PATH}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'CF-Connecting-IP': '203.0.113.7'
            },
            body: JSON.stringify({
                email: 'doctor@example.com',
                turnstileToken: 'token',
                consentVersion: 'v1',
                consentAccepted: true
            })
        }),
        env,
        async () => {
            fetchCalled = true;
            return createVerificationFetch()();
        }
    );

    assert.equal(response.status, 429);
    assert.equal(fetchCalled, false);
    assert.deepEqual(rateLimiter.calls, ['/subscribe:203.0.113.7']);
    assert.equal(env.DB.subscribers.size, 0);
});

test('consent versions are trimmed to a safe length before storage', async () => {
    const env = createEnv();
    const overlongConsentVersion = `v1-${'x'.repeat(90)}`;

    const response = await handleSubscribe(
        new Request(`https://api.myradone.com${SUBSCRIBE_PATH}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'doctor@example.com',
                turnstileToken: 'token',
                source: 'landing',
                consentVersion: overlongConsentVersion,
                consentAccepted: true
            })
        }),
        env,
        createVerificationFetch()
    );

    assert.equal(response.status, 200);
    assert.equal(env.DB.subscribers.get('doctor@example.com').consentVersion.length, 64);
});
