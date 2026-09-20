// Mock store webhook. Renewals and expiries arrive here, not from the client.

const express = require('express');
const crypto = require('crypto');

const Subscription = require('../models/subscription');
const SubscriptionEvent = require('../models/subscriptionEvent');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Real version is two endpoints: Apple POSTs signed App Store Server Notifications V2
// directly, Google publishes RTDNs via Pub/Sub. Both re-fetch state, not trust payload.
router.post(
  '/mock',
  asyncHandler(async (req, res) => {
    const { originalTransactionId, eventType } = req.body || {};

    // Real notifications always carry an id; generated here when omitted so next
    // month's genuine renewal isn't mistaken for a redelivery of this one.
    const notificationId = req.body?.notificationId || crypto.randomUUID();

    if (!originalTransactionId || !eventType) {
      throw new ApiError(
        'INVALID_RECEIPT',
        'originalTransactionId and eventType are required.',
        {}
      );
    }

    // Insert first and let the unique index reject repeats. Stores retry, and
    // findOne-then-insert would let two redeliveries both grant 30 days.
    let event;
    try {
      event = await SubscriptionEvent.create({
        source: 'store_webhook',
        eventType,
        notificationId,
        payload: req.body,
      });
    } catch (err) {
      if (err && err.code === 11000) {
        // 200, not an error: anything else makes the store retry harder.
        return res.json({ ok: true, deduplicated: true, notificationId });
      }
      throw err;
    }

    const subscription = await Subscription.findOne({ originalTransactionId });

    if (!subscription) {
      // Still 200: retrying won't conjure the row, and the event is on file.
      return res.json({ ok: true, ignored: 'unknown_subscription' });
    }

    event.subscriptionId = subscription._id;
    await event.save();

    // Nothing here touches an isPro flag, because there isn't one.
    if (eventType === 'renewed') {
      // From the later of expiry or now: keeps the anniversary for a live
      // subscription, gives a lapsed one a full 30 days.
      const base =
        subscription.currentPeriodEnd > new Date()
          ? subscription.currentPeriodEnd.getTime()
          : Date.now();

      subscription.currentPeriodEnd = new Date(base + THIRTY_DAYS_MS);
      subscription.status = 'active';
      await subscription.save();
    } else if (eventType === 'expired') {
      subscription.status = 'expired';
      await subscription.save();
    }
    // Other event types are logged and ignored; a real handler covers cancelled,
    // refunded, grace-period and on-hold.

    res.json({
      ok: true,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
    });
  })
);

module.exports = router;
