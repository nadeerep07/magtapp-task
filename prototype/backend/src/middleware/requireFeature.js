// The server-side gate. This is the lock; the client's paywall is only a sign.

const FeatureConfig = require('../models/featureConfig');
const UsageCounter = require('../models/usageCounter');
const { getEntitlement, currentWindow } = require('../services/entitlement');
const { ApiError, asyncHandler } = require('./errorHandler');

// A factory, so the feature key is fixed at route-definition time. Reading it from
// user input would let the client choose which rule to be judged by.
function requireFeature(featureKey) {
  return asyncHandler(async (req, res, next) => {
    const config = await FeatureConfig.findOne({ key: featureKey });

    if (!config) {
      // Fail closed: an unseeded feature must not become an open one.
      throw new ApiError(
        'PRO_REQUIRED',
        'This feature is not available.',
        { feature: featureKey }
      );
    }

    const { isPro } = await getEntitlement(req.user.id);

    // A patched client can render the Pro screen; this is what its requests hit.
    if (config.requiredTier === 'pro' && !isPro) {
      throw new ApiError(
        'PRO_REQUIRED',
        'This feature requires MagTapp Pro.',
        { feature: featureKey, requiredTier: 'pro' }
      );
    }

    const metered = config.freeLimit !== null && config.freeLimit !== undefined;

    if (metered && !isPro) {
      const windowStart = currentWindow();

      // Increment-then-check in one atomic update. Read-compare-write would let
      // six concurrent calls all see "4 used" and all pass.
      const counter = await UsageCounter.findOneAndUpdate(
        { userId: req.user.id, featureKey, windowStart },
        { $inc: { count: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      if (counter.count > config.freeLimit) {
        // No compensating decrement: they're refused either way, and this stays
        // a single atomic op with no failure mode where the refund is lost.
        throw new ApiError(
          'FEATURE_LIMIT_REACHED',
          'Daily free limit reached. Upgrade to Pro for unlimited access.',
          {
            feature: featureKey,
            limit: config.freeLimit,
            used: counter.count,
            resetsAt: new Date(
              Date.parse(windowStart) + 24 * 60 * 60 * 1000
            ).toISOString(),
          }
        );
      }
    }

    next();
  });
}

module.exports = requireFeature;
