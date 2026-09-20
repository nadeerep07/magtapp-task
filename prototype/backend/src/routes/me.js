// Entitlement lookup: what the client asks on launch, after purchase, and on resume.

const express = require('express');

const auth = require('../middleware/auth');
const { getEntitlementSnapshot } = require('../services/entitlement');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// One endpoint for every path that changes entitlement, so the client never
// computes its own answer. Drives the paywall UI; requireFeature does the enforcing.
router.get(
  '/entitlement',
  auth,
  asyncHandler(async (req, res) => {
    const snapshot = await getEntitlementSnapshot(req.user.id);
    res.json(snapshot);
  })
);

module.exports = router;
