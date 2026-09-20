// Computes what a user is allowed to do. Every gate calls this.

const Subscription = require('../models/subscription');
const FeatureConfig = require('../models/featureConfig');
const UsageCounter = require('../models/usageCounter');

// grace keeps access (declined card, store retrying — don't churn a paying user).
// cancelled needs no entry: the expiry check below already grants until period end.
const ENTITLING_STATUSES = ['active', 'grace'];

// Shared so the counter written by requireFeature and the one read here agree on the day.
function currentWindow(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// isPro is COMPUTED, never stored: a stored flag goes stale the moment a
// subscription expires, and is a field something could eventually let the client write.
function isProFrom(subscription, now = new Date()) {
  if (!subscription) return false;

  return (
    ENTITLING_STATUSES.includes(subscription.status) &&
    subscription.currentPeriodEnd > now
  );
}

// Read fresh per request. A short-TTL cache would go here — safe for a derived
// value, since a stale entry expires on its own; a stale column stays wrong forever.
async function getEntitlement(userId, now = new Date()) {
  const subscription = await Subscription.findOne({ userId });
  const isPro = isProFrom(subscription, now);

  return {
    isPro,
    tier: isPro ? 'pro' : 'free',
    subscription,
  };
}

// Powers GET /v1/me/entitlement, which the client renders its paywall from.
async function getEntitlementSnapshot(userId, now = new Date()) {
  const { isPro, tier } = await getEntitlement(userId, now);

  const configs = await FeatureConfig.find({}).sort({ key: 1 });
  const windowStart = currentWindow(now);

  // One query for all counters rather than one per feature.
  const counters = await UsageCounter.find({
    userId,
    windowStart,
    featureKey: { $in: configs.map((c) => c.key) },
  });

  const usedByKey = new Map(counters.map((c) => [c.featureKey, c.count]));

  const features = {};
  for (const config of configs) {
    const entry = { tier: config.requiredTier };

    // Only metered features report limit/used; a pure Pro lock has no allowance.
    if (config.freeLimit !== null && config.freeLimit !== undefined) {
      // null for Pro users so the client doesn't draw a bar that never fills.
      entry.limit = isPro ? null : config.freeLimit;
      entry.used = usedByKey.get(config.key) || 0;
    }

    features[config.key] = entry;
  }

  return { tier, features };
}

module.exports = {
  isProFrom,
  getEntitlement,
  getEntitlementSnapshot,
  currentWindow,
  ENTITLING_STATUSES,
};
