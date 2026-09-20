# Architecture

This is how I'd structure MagTapp if I were building it now. It isn't a guess at
the current system. It comes from using the app, and the bugs I hit along the
way are in the product observations doc.

## 1. What the product actually is

Using the app for a few hours, it splits into four things with very different
characteristics.

**The browser.** Search, URL bar, tabs, incognito, in-app browsing. Needs no
backend at all. Search engines are URL templates and the WebView does the
rendering, which I confirmed by changing the engine in settings and checking
what New Tab loads for each one.

**The visual dictionary.** Tap a word, get an image, a translation, an example
sentence and audio. This is the feature the product is built around, and the
highest-volume call in the system.

**The other AI tools.** Translate, Documents, read-aloud, AI search. Every
request costs money, takes time and can fail. This is where the infrastructure
bill lives.

**Content.** Books, Quiz, Games, Trending Now. Read-heavy, mostly static,
highly cacheable. Some books are already locked, so there's an existing
access-tier concept in the product.

Plus accounts, which are low volume but have to be correct.

Most of the decisions below follow from that split.

## 2. Client architecture

Flutter, feature-first, clean architecture inside each feature, BLoC for state.

```
lib/
├── core/
│   ├── config/        env, api base url, search engine config
│   ├── network/       dio client, interceptors, token refresh
│   ├── storage/       secure storage, local db
│   ├── error/         failures and exceptions
│   ├── theme/
│   └── router/
├── features/
│   ├── onboarding/
│   ├── auth/
│   ├── home/
│   ├── browser/
│   ├── dictionary/
│   ├── ai_tools/
│   ├── content/
│   ├── profile/
│   ├── settings/
│   └── subscription/
└── shared/
    ├── widgets/       form fields, buttons, locked states
    └── entitlement/   the feature gate
```

Each feature has `data/`, `domain/` and `presentation/`. Feature-first rather
than layer-first because I'd be working across the whole stack. When something
breaks in subscriptions, everything for subscriptions is in one folder instead
of spread across four layer directories. It also keeps modules independent
enough that a new feature can be added without touching unrelated code.

BLoC because the event and state stream is easy to log, which matters for the AI
flows where you want to know exactly what the user did before something failed.

Four parts are worth calling out.

**`shared/entitlement/`** is deliberately not a feature. Dictionary, AI tools
and books all ask the same question, so the answer can't live inside any one of
them. Section 6.

**`shared/widgets/`** exists because of what I found in the sign-in form. The
same validation rule was implemented twice with two different error styles. A
shared field component makes that impossible rather than fixing it once.

**`features/browser/`** is the odd one. Its repository has no remote data
source. Tabs are local, engines come from config, the WebView does the work.

**`features/dictionary/`** is its own module rather than part of `ai_tools`
because it's the highest-volume feature and the one most worth caching.

### The browser is one component with three entry points

New Tab loads the selected engine's home URL. Search loads the engine's query
URL. A Trending article loads its own URL directly. All three open in the same
WebView and the same tab stack.

```dart
openInBrowser(Uri url)
```

The engine setting only decides what loads when there's no specific URL.

### Search engine config

Each engine needs two URLs, not one.

```dart
class SearchEngine {
  final String id;        // 'google'
  final String name;
  final String homeUrl;   // opened by New Tab
  final String queryUrl;  // '{q}' substituted
}
```

Ship a local JSON fallback, fetch the live list from the backend. In the current
build, New Tab with DuckDuckGo selected opens `duckduckgo.com/?q=`, which is a
search for an empty string rather than the home page, and Bing has `cc=IN`
hardcoded for a product used in 106 countries. Both are one-line config fixes
that currently need a store release.

## 3. Backend

Express, structured as a modular monolith. One deployable, clear boundaries
inside it.

```
src/
├── modules/
│   ├── auth/
│   ├── user/
│   ├── subscription/
│   ├── entitlement/
│   ├── dictionary/
│   ├── ai/
│   └── content/
├── middleware/         auth, requireFeature, error handler, rate limit
├── config/
└── utils/
```

Not microservices. One engineer running the whole stack can't operate a
distributed system — separate deployables mean separate pipelines, separate
logs, and cross-service debugging for every bug. A modular monolith gives the
same boundaries with one thing to deploy and one place to look. If the
dictionary later needs to scale differently, it's the obvious first thing to
pull out and the line is already drawn.

### Caching matters most in the dictionary

Word lookups repeat heavily. A few thousand common words will cover most taps,
so a cached lookup should almost never reach the origin. This is the cheapest
large win in the system.

### The AI module

Slow, expensive, third-party dependencies, variable latency. Own timeouts, own
circuit breaker, own queue for anything that doesn't need to be synchronous.

## 4. Authentication

JWT access token plus refresh token.

- Access token, 15 minutes, bearer header.
- Refresh token, long lived, rotated on use, stored in Keychain on iOS and
  KeyStore on Android via `flutter_secure_storage`.
- Refresh handled in a Dio interceptor, so a 401 triggers a silent refresh and
  one retry. If refresh fails, sign the user out.

Google and Apple both go through the same path. The client gets an ID token from
the provider and posts it. The backend verifies it against Google's or Apple's
public keys, then issues its own tokens. The client never gets to assert who it
is.

Apple sign-in is required on iOS if Google sign-in is offered, so it ships
alongside.

### One account, multiple login methods

A user signs up with email and password using `name@gmail.com`. Later they tap
Continue with Google with the same address. That has to resolve to one account,
not two.

```
users
  _id
  email: name@gmail.com
  authProviders: [
    { provider: 'email',  passwordHash: ... },
    { provider: 'google', providerUid: '1093...' }
  ]
```

This matters directly for Pro. If Google login created a second account, someone
who subscribed through email login would sign in with Google and find no
subscription. Same person, same payment, no access, and a support ticket that's
awkward to resolve.

So: the verified email decides the account, and a new provider links to the
existing one rather than creating a duplicate.

Two things from the sign-in failures I hit. Errors have to reach the UI, and the
messages must not reveal whether an email is registered. Tell the user what to
do next, not who exists.

## 5. API design

REST over HTTPS, versioned by path.

```
/v1/auth/google
/v1/auth/refresh
/v1/me
/v1/me/entitlement
/v1/subscriptions/verify
/v1/webhooks/apple
/v1/webhooks/google
/v1/dictionary/lookup
/v1/ai/translate
/v1/content/books
/v1/content/trending
/v1/sync/tabs
```

One error shape everywhere:

```json
{
  "error": {
    "code": "FEATURE_LIMIT_REACHED",
    "message": "Daily translation limit reached",
    "details": { "limit": 5, "used": 5, "resetsAt": "..." }
  }
}
```

The client switches on `code`, never `message`. Messages change, codes don't.

Idempotency keys on anything that writes money-adjacent state. Store webhooks
retry, so verify and webhook endpoints must be safe to call twice with the same
payload.

Cursor pagination on anything that grows, like AI activity and history.

## 6. Feature access and entitlement

The rule: the client never decides what a user can access. It asks, and renders
what it's told.

```
GET /v1/me/entitlement

{
  "tier": "free",
  "features": {
    "dictionary": { "tier": "free", "limit": 20, "used": 4 },
    "translate":  { "tier": "free", "limit": 5,  "used": 3 },
    "documents":  { "tier": "pro" },
    "books_pro":  { "tier": "pro" },
    "quiz_deep":  { "tier": "pro" }
  }
}
```

Which features are free, which are Pro, and what the allowance is all come from
config in the database. Moving a feature behind Pro is a config change, not a
release. For a product introducing paid tiers for the first time, that matters,
because the first guess at where the line sits is usually wrong.

On the client, one gate used everywhere:

```dart
FeatureGate(
  featureKey: 'translate',
  child: TranslateScreen(),
)
```

Three states. Locked by tier gets an upgrade prompt. Limit reached gets "5 of 5
used today" plus the upgrade path, which converts better because the user has
already had the value. Allowed gets the feature.

If entitlement can't be fetched, use the last cached value for a short window
then fail closed. That avoids punishing paying users on a bad connection while
keeping the failure safe.

On the server, one middleware:

```js
router.post('/translate', auth, requireFeature('translate'), handler);
```

It reads the feature config, reads entitlement, checks the counter where there's
a limit, and returns 403 or 429. Every gated route gets one line. A new route
missing it is visible in review rather than buried in a handler.

**On client tampering.** The client has no tier logic to tamper with. There's no
`isPro` boolean anywhere it can reach. Patching the app to render the translate
screen produces a screen whose requests return 403. The client gate is UX so
users don't walk into locked doors. The server gate is the lock.

## 7. Data model

MongoDB. Access patterns are mostly key lookups by user, and it's the stack I'd
build this in fastest.

One caveat on record. Subscription data is the part that most wants relational
guarantees, specifically a hard uniqueness constraint on the store transaction
ID so one receipt can't be claimed by two accounts. Mongo enforces that with a
unique index and it's fine at this scale. If billing gets more complex, moving
subscriptions to Postgres while leaving everything else on Mongo is the first
change I'd make.

```
users
  _id, email, authProviders[], createdAt, updatedAt
  unique index on email
  unique index on (provider, providerUid)

subscriptions
  _id, userId, platform, productId,
  originalTransactionId,      // unique index — the anti-sharing control
  status,                     // active | grace | onHold | cancelled | expired
  currentPeriodEnd, autoRenewing
  index on (userId, status)

subscriptionEvents
  _id, subscriptionId, source, eventType,
  notificationId,             // unique index — webhooks retry
  payload, receivedAt

featureConfig
  key, requiredTier, freeLimit, window

usageCounters
  _id, userId, featureKey, windowStart, count
  index on (userId, featureKey, windowStart)

aiActivity
  _id, userId, feature, query, createdAt

dictionaryEntries
  _id, word, language, imageUrl, translation,
  exampleSentence, audioUrl
  unique index on (word, language)

articles
  _id, title, imageUrl, sourceUrl, publisher,
  category, publishedAt
  index on (category, publishedAt)

books
  _id, title, fileUrl, accessTier

syncItems
  _id, userId, type,          // tab | bookmark | history
  payload, updatedAt, deletedAt
```

There is no `isPro` field anywhere. Pro is derived:

```
isPro = status in ('active', 'grace') && currentPeriodEnd > now
```

Computed server-side, cached in Redis with a short TTL. The moment it becomes a
stored boolean, something will write to it from a request body.

`aiActivity` and `usageCounters` are separate on purpose. Activity is user
history and should be deletable. Counters are metering and shouldn't be. Same
collection would mean clearing your history resets your free allowance.

`dictionaryEntries` having a unique index on word and language is what makes the
cache work. Lookups are repetitive, so this collection should be small, hot and
almost always served from Redis.

### What I could tell about storage from the outside

I cleared app data and signed back in. Tabs and onboarding were gone, AI
activity was still there. So AI queries are stored server-side against the
account while browsing state is local only.

Worth noting because AI query history is the most sensitive data the product
holds — queries reveal more than URLs. It needs a stated retention window, a
user-facing delete, and hard exclusion from incognito.

## 8. Scalability and reliability

The useful question is what degrades versus what breaks.

| Component down | Effect |
|---|---|
| AI service | AI tools error, browsing unaffected |
| Dictionary | Word lookup fails, rest of the app unaffected |
| Content service | Books, quiz, trending unavailable |
| Auth | Existing sessions work until token expiry |

Browsing and tabs need no backend, so they should keep working when any of the
above is down. Failure should stay inside the feature that failed.

Specifics:

- Stateless API servers behind a load balancer, scale horizontally.
- Redis for entitlement, feature config and dictionary lookups. All read
  constantly, all change rarely.
- CloudFront in front of dictionary images, book files and the trending feed.
  Cheap traffic that should never reach origin.
- Queue slow AI work that doesn't need a synchronous response, so a provider
  slowdown creates a backlog rather than held connections.
- Per-user rate limits on AI endpoints, separate from entitlement limits. One
  protects the business model, the other protects the infrastructure.
- Circuit breaker around third-party AI providers, with a cached or degraded
  response instead of a hang.

On failure states in the UI. Translation currently renders a blank page when it
fails, which is the worst outcome — the user can't tell whether it's broken or
empty, and neither can support. Every AI feature needs a defined failure state.

## 9. AWS services

| Service | Why |
|---|---|
| ECS Fargate | Runs Express without managing EC2. Right-sizing is a task definition change |
| ALB | TLS termination, health checks, rolling deploys |
| MongoDB Atlas or DocumentDB | Managed Mongo |
| ElastiCache Redis | Entitlement cache, feature config, dictionary lookups, rate limit counters |
| S3 | Dictionary images, book files, uploaded documents |
| CloudFront | CDN in front of S3 and the trending feed. Biggest single cost lever at this volume |
| SQS | Async AI jobs, webhook processing |
| Secrets Manager | Store credentials, API keys, signing keys |
| CloudWatch | Metrics, logs, alarms |
| SNS + Pub/Sub bridge | Apple notifications and Google Play RTDN land here |
| WAF | Protection on public endpoints |

Deliberately not included. Cognito, because auth is simple enough that rolling
it keeps provider-linking logic in our own code and avoids a migration if
requirements diverge. Kubernetes, because Fargate covers the need at this size
without a platform to operate.

Cost work is in the AWS document.