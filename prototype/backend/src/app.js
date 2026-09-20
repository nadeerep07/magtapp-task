// Builds the Express app: middleware, routes, error handler.

const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const subscriptionRoutes = require('./routes/subscription');
const aiRoutes = require('./routes/ai');
const webhookRoutes = require('./routes/webhook');
const { errorHandler } = require('./middleware/errorHandler');

// A factory, so requiring this file binds no port and assumes no database.
function createApp() {
  const app = express();

  // Wide open for the prototype. CORS protects nobody here anyway — a native app
  // or curl ignores it, which is why the real enforcement is requireFeature.
  app.use(cors());

  app.use(express.json());

  // Versioned from the first commit: old mobile installs keep calling their URL
  // for years, so a v2 alongside v1 is the only safe way to change a response.
  app.use('/v1/auth', authRoutes);
  app.use('/v1/me', meRoutes);
  app.use('/v1/subscriptions', subscriptionRoutes);
  app.use('/v1/ai', aiRoutes);
  app.use('/v1/webhooks', webhookRoutes);

  app.get('/health', (req, res) => res.json({ ok: true }));

  // Same error shape as everything else, so a typo'd path doesn't return HTML.
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `No route for ${req.method} ${req.path}`,
        details: {},
      },
    });
  });

  // Last: Express only reaches error handlers registered after the routes.
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
