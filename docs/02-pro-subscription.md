# MagTapp Pro

Design for a ₹99/month subscription. Covers the purchase flow, backend
verification, what happens when payments fail or renew, restoring on a new
device, and why the client can't fake Pro.

## 1. The thing to get right first

With a payment gateway like Razorpay or Stripe, you control the payment. Your
server creates an order, the user pays, you get a callback, you verify a
signature.

Store subscriptions don't work that way. Apple and Google own the payment
relationship completely. You never see a card, you never charge anyone, and the
store bills the user every month whether or not your app is running.

So this isn't payment processing. It's syncing state from Apple and Google, and
every design decision below follows from that.

It also means IAP is not optional. Store policy requires in-app digital goods to
go through Apple IAP and Google Play Billing, at 15–30%. Razorpay is only an
option for a web purchase flow outside the app, which is a separate decision and
not what I'd ship first.

## 2. The purchase flow

```
App                     Store                   Backend
 │                        │                        │
 │─ fetch products ──────▶│                        │
 │◀─ ₹99/month ───────────│                        │
 │                        │                        │
 │─ user taps Subscribe ─▶│                        │
 │   (store's own sheet)  │                        │
 │◀─ purchase token ──────│                        │
 │                        │                        │
 │─ POST /subscriptions/verify ──────────────────▶│
 │                        │◀─ verify token ────────│
 │                        │── real details ───────▶│
 │                        │                        │─ write subscription
 │◀─ 200 ─────────────────────────────────────────│
 │                        │                        │
 │─ GET /me/entitlement ─────────────────────────▶│
 │◀─ { tier: "pro" } ─────────────────────────────│
```

Two things worth noticing.

The app never tells the backend "this user is Pro". It hands over a token and
the backend goes and asks the store what that token actually means. The app is
a courier, not an authority.

And after a successful purchase the app still fetches entitlement from the API
rather than flipping a local flag. One path to Pro status, used by purchase,
restore, app launch and every other case.

## 3. Verification

The token arrives from the client, so it can't be trusted. It could be
fabricated, replayed, or copied from another user's purchase. Verification is
what makes it real.

**iOS** — the app sends the signed transaction. The backend verifies it with the
App Store Server API, which returns the subscription's real state: product,
original transaction ID, expiry, renewal status.

**Android** — the app sends the `purchaseToken`. The backend calls the Google
Play Developer API `purchases.subscriptions.get`, which returns the same kind of
data.

```
POST /v1/subscriptions/verify
{ "platform": "android", "purchaseToken": "...", "productId": "pro_monthly" }

handler:
  claims = verifyWithStore(platform, token)       // Apple or Google
  if not valid:            return 422 INVALID_RECEIPT

  existing = findByOriginalTransactionId(claims.originalTransactionId)
  if existing and existing.userId != currentUser:
      return 409 RECEIPT_ALREADY_CLAIMED

  upsertSubscription(currentUser, claims)
  recordEvent('client_verify', claims)
  invalidateEntitlementCache(currentUser)
  return 200 { status, currentPeriodEnd }
```

The 409 case is the anti-sharing control. `originalTransactionId` is unique in
the database, so one real purchase maps to exactly one account. Without it, one
person buys Pro and passes the token round a WhatsApp group.

Verification also has to be idempotent. The app may retry on a flaky network,
and the same token arriving twice for the same user should produce the same
result, not a duplicate row.

## 4. Where subscription status lives

Two collections, plus a derived value that is never stored.

```
subscriptions
  userId, platform, productId,
  originalTransactionId,     // unique index
  status,                    // active | grace | onHold | cancelled | expired
  currentPeriodEnd, autoRenewing

subscriptionEvents
  subscriptionId, source, eventType,
  notificationId,            // unique index
  payload, receivedAt
```

Entitlement is computed, not stored:

```
isPro = status in ('active', 'grace') && currentPeriodEnd > now
```

Cached in Redis with a short TTL, invalidated whenever a subscription row
changes.

There is no `isPro` boolean in the database. The moment one exists, something
eventually writes to it from a request body, and then the client can set its own
access level. Deriving it means there's nothing to set.

`subscriptionEvents` is append-only. It's what lets you answer "I paid, why am I
not Pro?" with a timeline instead of a guess, and it means state can be rebuilt
if a row ever drifts from what the store thinks.

## 5. Renewals, failures and expiry

A subscription renews monthly without the app being involved. The user might not
open it for six weeks. So the client can't be the source of truth for renewal —
the stores have to tell the backend directly.

**Webhooks.** Apple sends App Store Server Notifications V2 to an HTTPS
endpoint. Google sends Real-Time Developer Notifications through Pub/Sub. Both
deliver renewed, cancelled, refunded, billing-retry, grace-period and expired
events.

```
POST /v1/webhooks/apple
POST /v1/webhooks/google

handler:
  verify signature / Pub/Sub auth
  if seen(notificationId):  return 200          // already processed
  claims = fetchCurrentStateFromStore(...)      // don't trust the payload alone
  updateSubscription(claims)
  recordEvent(notificationId, claims)
  invalidateEntitlementCache(userId)
  return 200
```

Two details that matter. Webhooks retry, so `notificationId` is unique and a
repeat is a no-op returning 200 — if you don't do this, a retried renewal gets
processed twice. And the handler re-fetches current state from the store rather
than trusting the notification body, so an out-of-order delivery can't write
stale data over newer data.

**Polling as backup.** Webhooks get missed — endpoint down, deploy in progress,
Pub/Sub hiccup. A daily job re-checks any subscription whose `currentPeriodEnd`
is near or past and reconciles it. Webhooks for speed, polling for correctness.

### Payment failure

When a card declines the store doesn't cancel. It retries over days or weeks.

```
active   → paid and current
grace    → payment failed, store retrying, user keeps access
onHold   → retries exhausted, access revoked
cancelled→ won't renew, access continues until currentPeriodEnd
expired   → over
```

Two of these look wrong at first glance and are deliberate.

`grace` keeps access. The user isn't a fraudster, their card expired. Cutting
Pro the moment a payment fails punishes a paying customer for a bank problem,
and they churn. The store gives a retry window, so honour it and prompt them to
update payment.

`cancelled` also keeps access until the period ends. They've paid for the month.
Cancelling means "don't renew", not "refund me now".

Refunds are the exception: entitlement ends immediately.

## 6. Restoring on another device

This is already solved by tying entitlement to the account rather than the
device.

```
User installs on a new phone → signs in → GET /me/entitlement → Pro
```

No store interaction needed. The subscription row is keyed to `userId`, so any
device signed into that account gets the same answer.

The store's own "restore purchases" flow is a fallback for the case where
someone purchased while signed out, or signs in with a different account than
they bought under. It re-reads the receipt from the device and posts it to
`/subscriptions/verify`, which links it to the current account — unless the
`originalTransactionId` already belongs to someone else, in which case it's a
409.

This is also where account identity matters. Someone who subscribes after
signing up with email, then later signs in with Google using the same address,
has to land on the same account. If provider login created a duplicate, they'd
be a paying user with no Pro. Linking providers to one account by verified email
prevents it.

## 7. Preventing client-side manipulation

The direct answer: the client has nothing to manipulate.

There is no `isPro` flag in the app that can be flipped. The app asks
`/me/entitlement` and renders what it's told. Patching the APK to render the
Documents screen produces a screen whose requests return 403.

Every gated endpoint checks entitlement server-side:

```js
router.post('/ai/translate', auth, requireFeature('translate'), handler);
```

```
requireFeature(key):
  config = featureConfig[key]
  ent    = entitlement(userId)              // derived, cached

  if config.requiredTier == 'pro' and not ent.isPro:
      return 403 PRO_REQUIRED

  if config.freeLimit and not ent.isPro:
      used = counter(userId, key, window)
      if used >= config.freeLimit:
          return 429 FEATURE_LIMIT_REACHED
      increment(userId, key, window)

  next()
```

The layers, stated plainly:

| Layer | What it does |
|---|---|
| Store | Owns the payment. Can't be bypassed without a real purchase |
| Verification | Tokens confirmed with Apple/Google, not accepted from the client |
| Unique transaction ID | One purchase, one account |
| Derived entitlement | No stored flag anywhere the client can influence |
| Server-side gate | Every Pro request checked independently |

The client gate is UX, so users don't walk into locked doors. The server gate is
the lock.

Two things it deliberately doesn't try to stop. A rooted device can see and
modify anything in the app, so the app assumes it's hostile and keeps nothing
worth stealing. And someone sharing their own login credentials is an account
sharing problem, not a receipt problem — worth watching through concurrent
session counts before adding friction for everyone else.

## 8. What Pro includes

Which features are Pro and which are free comes from `featureConfig` in the
database, not from code. Moving translation behind Pro is a config change, not a
release.

That matters because the first guess at where the free/paid line sits is usually
wrong, and this is the company's first paid tier. Being able to move it on data
after launch is worth more than getting it right on day one.

The same mechanism supports a free daily allowance — a limit on a free-tier
feature rather than a hard lock. Hitting a limit after using something converts
better than seeing a locked door, because the user has already had the value.
Architecturally it's the same code path.

## 9. What I'd build first

1. `featureConfig`, `subscriptions`, entitlement endpoint, `requireFeature`.
   Everything else depends on this and it's testable without any store setup.
2. Android verification end to end, because Play's developer API is quicker to
   get working than App Store Server API.
3. Webhooks, both platforms, with the idempotency and re-fetch behaviour above.
4. iOS verification.
5. Daily reconciliation job.
6. The paywall UI last. It's the easiest part to change and the least risky to
   get wrong.

The prototype in this repo covers step 1 with a mocked store response, since
that's the part that carries the security argument.