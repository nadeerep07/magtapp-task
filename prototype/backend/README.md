# Prototype backend

Node + Express + MongoDB. Demonstrates server-side Pro entitlement.

## Run

Requires Node 18+ and MongoDB running locally.

```bash
npm install
cp .env.example .env
npm run seed
npm start
```

## Demo

```bash
TOKEN=$(curl -s -X POST localhost:4000/v1/auth \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')

# free user hits a Pro endpoint
curl -s -w '\nHTTP %{http_code}\n' localhost:4000/v1/ai/documents \
  -H "Authorization: Bearer $TOKEN"

# subscribe
curl -s -X POST localhost:4000/v1/subscriptions/verify \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"platform":"android","purchaseToken":"valid_001","productId":"pro_monthly"}'

# identical request to the first one
curl -s -w '\nHTTP %{http_code}\n' localhost:4000/v1/ai/documents \
  -H "Authorization: Bearer $TOKEN"
```

Use a fresh email each run — once subscribed, that user stays Pro for 30 days.

Or open `requests.http` in VS Code with the REST Client extension.

## Endpoints

| | |
|---|---|
| `POST /v1/auth` | Create or find user, return JWT |
| `GET /v1/me/entitlement` | Computed tier and feature access |
| `POST /v1/subscriptions/verify` | Mock store verification, writes subscription |
| `GET /v1/ai/translate` | Free tier, 5/day |
| `GET /v1/ai/documents` | Pro only |
| `POST /v1/webhooks/mock` | Simulates a store renewal or expiry event |

## Notes

Store verification is mocked — a token starting `valid_` stands in for a call
to the Play Developer API or App Store Server API.

There is no `isPro` field in any model. It's computed in
`services/entitlement.js` from subscription status and period end.