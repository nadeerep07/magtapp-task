// Per-user, per-feature, per-day usage count for metered free features.

const mongoose = require('mongoose');

// Separate from the user doc: high-churn rows that are junk tomorrow.
const usageCounterSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    featureKey: { type: String, required: true },

    // 'YYYY-MM-DD' in UTC. A label, not a Date, so the index below expresses the
    // rule directly. UTC means reset at 05:30 IST; real version buckets per-user.
    windowStart: { type: String, required: true },

    count: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Unique so two concurrent first-calls can't create two rows and double the allowance.
usageCounterSchema.index(
  { userId: 1, featureKey: 1, windowStart: 1 },
  { unique: true }
);

module.exports = mongoose.model('UsageCounter', usageCounterSchema);
