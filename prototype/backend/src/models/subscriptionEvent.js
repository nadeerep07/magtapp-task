// Append-only log of everything that happened to a subscription.

const mongoose = require('mongoose');

// Gives webhooks their idempotency, and answers "I paid, why am I not Pro?".
const subscriptionEventSchema = new mongoose.Schema(
  {
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      index: true,
    },

    source: { type: String, required: true },

    eventType: { type: String, required: true },

    // UNIQUE is the dedup mechanism: insert first and let a duplicate key tell us
    // we've seen this notification, rather than racing a findOne-then-insert.
    notificationId: { type: String, required: true, unique: true },

    payload: { type: mongoose.Schema.Types.Mixed },

    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SubscriptionEvent', subscriptionEventSchema);
