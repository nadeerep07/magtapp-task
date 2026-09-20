// Sign-in for the prototype: email in, JWT out.

const express = require('express');
const jwt = require('jsonwebtoken');

const User = require('../models/user');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// PROTOTYPE SHORTCUT: no password, so anyone can mint a token for any email.
// Acceptable only because this demonstrates entitlement, not authentication.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { email } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'email is required.',
          details: {},
        },
      });
    }

    const normalised = email.trim().toLowerCase();

    // Atomic find-or-create: two simultaneous first sign-ins would otherwise race
    // the unique index on email.
    const user = await User.findOneAndUpdate(
      { email: normalised },
      { $setOnInsert: { email: normalised } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const token = jwt.sign(
      { sub: user._id.toString(), email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user._id, email: user.email } });
  })
);

module.exports = router;
