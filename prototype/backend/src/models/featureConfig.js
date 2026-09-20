// Which features are Pro and how much free users get. Seeded by src/seed.js.

const mongoose = require('mongoose');

// In the database, not in code: moving the paywall is an UPDATE, not a release.
const featureConfigSchema = new mongoose.Schema(
  {
    // The string routes pass to requireFeature('translate').
    key: { type: String, required: true, unique: true },

    // 'pro' = hard lock (403 for free users); 'free' = open, subject to freeLimit.
    requiredTier: { type: String, enum: ['free', 'pro'], required: true },

    // Daily free allowance; null means unlimited. Lock and limit share one code path.
    freeLimit: { type: Number, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FeatureConfig', featureConfigSchema);
