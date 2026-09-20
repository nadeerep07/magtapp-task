// What the store told us about one purchase. Source of truth for entitlement.

const mongoose = require('mongoose');

// grace = payment failed but access continues; cancelled = access until period end.
const SUBSCRIPTION_STATUSES = ['active', 'grace', 'onHold', 'cancelled', 'expired'];

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    platform: { type: String, enum: ['ios', 'android'], required: true },

    productId: { type: String, required: true },

    // UNIQUE is the anti-sharing control: one purchase maps to exactly one account,
    // enforced by the database rather than by a check a refactor could drop.
    originalTransactionId: {
      type: String,
      required: true,
      unique: true,
    },

    status: {
      type: String,
      enum: SUBSCRIPTION_STATUSES,
      required: true,
    },

    // Compared to now() on every gated request, so expiry needs no job and no flag.
    currentPeriodEnd: { type: Date, required: true },

    autoRenewing: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Subscription', subscriptionSchema);
module.exports.SUBSCRIPTION_STATUSES = SUBSCRIPTION_STATUSES;
