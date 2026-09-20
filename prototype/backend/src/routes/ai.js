// The two gated features. The middleware list is the interesting part, not the bodies.

const express = require('express');

const auth = require('../middleware/auth');
const requireFeature = require('../middleware/requireFeature');

const router = express.Router();

// Free but metered: hitting a cap after getting value converts better than a
// locked door. Which side of the line it sits on is a featureConfig row.
router.get('/translate', auth, requireFeature('translate'), (req, res) => {
  res.json({
    feature: 'translate',
    result: 'नमस्ते (mock translation)',
  });
});

// The point of the prototype: a patched client can render this screen, and the
// request still 403s because requireFeature derives the answer server-side.
router.get('/documents', auth, requireFeature('documents'), (req, res) => {
  res.json({
    feature: 'documents',
    result: 'Mock document summary: 3 key points extracted from your PDF.',
  });
});

module.exports = router;
