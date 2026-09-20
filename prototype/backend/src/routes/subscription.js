// Turns a verified store purchase into a subscription row.

const express = require('express');

const auth = require('../middleware/auth');
const Subscription = require('../models/subscription');
const SubscriptionEvent = require('../models/subscriptionEvent');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// IN PRODUCTION THIS IS THE STORE CALL: Google Play Developer API
// purchases.subscriptions.get, or App Store Server API. Never trust the client's body.
function verifyWithStore(platform, purchaseToken, productId) {
  if (typeof purchaseToken !== 'string' || !purchaseToken.startsWith('valid_')) {
    return null;
  }

  // Derived deterministically, so the same token always maps to the same id.
  const originalTransactionId = `otx_${purchaseToken.slice('valid_'.length)}`;

  return {
    originalTransactionId,
    productId: productId || 'pro_monthly',
    status: 'active',
    // Mock caveat: this recomputes "30 days from now" each call, so re-verifying
    // nudges the expiry forward. A real store returns a fixed expiry per purchase.
    currentPeriodEnd: new Date(Date.now() + THIRTY_DAYS_MS),
    autoRenewing: true,
  };
}

// The client is a courier: it hands over a token, we ask the store what it means.
router.post(
  '/verify',
  auth,
  asyncHandler(async (req, res) => {
    const { platform, purchaseToken, productId } = req.body || {};

    if (platform !== 'ios' && platform !== 'android') {
      throw new ApiError(
        'INVALID_RECEIPT',
        'platform must be "ios" or "android".',
        { platform }
      );
    }

    const claims = verifyWithStore(platform, purchaseToken, productId);

    if (!claims) {
      throw new ApiError(
        'INVALID_RECEIPT',
        'The store could not verify this purchase.',
        { platform }
      );
    }

    // Anti-sharing: without this, one bought token gets pasted round a group chat.
    // This check is the good error message; the unique index is the guarantee.
    const existing = await Subscription.findOne({
      originalTransactionId: claims.originalTransactionId,
    });

    if (existing && existing.userId.toString() !== req.user.id) {
      throw new ApiError(
        'RECEIPT_ALREADY_CLAIMED',
        'This purchase is already linked to another account.',
        { originalTransactionId: claims.originalTransactionId }
      );
    }

    // Upsert, because apps retry on flaky networks and re-post receipts on restore.
    const subscription = await Subscription.findOneAndUpdate(
      { originalTransactionId: claims.originalTransactionId },
      {
        $set: {
          userId: req.user.id,
          platform,
          productId: claims.productId,
          status: claims.status,
          currentPeriodEnd: claims.currentPeriodEnd,
          autoRenewing: claims.autoRenewing,
        },
        $setOnInsert: { originalTransactionId: claims.originalTransactionId },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Best-effort: a failed audit write must not fail a purchase already charged.
    await SubscriptionEvent.create({
      subscriptionId: subscription._id,
      source: 'client_verify',
      eventType: 'verified',
      notificationId: `verify_${claims.originalTransactionId}_${Date.now()}`,
      payload: { platform, productId: claims.productId },
    }).catch(() => {});

    // Returns the subscription, not a tier: entitlement arrives by one route only.
    res.json({
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      productId: subscription.productId,
    });
  })
);

module.exports = router;
