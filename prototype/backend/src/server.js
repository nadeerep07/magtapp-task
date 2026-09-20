// Entry point: load env, connect to MongoDB, start listening.

require('dotenv').config();

const { createApp } = require('./app');
const { connectDB } = require('./config/db');

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI;

// Database first, port second — there's no point serving traffic without one.
async function start() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  if (!process.env.JWT_SECRET) {
    // No fallback secret: a default one survives into production and makes every
    // token forgeable, which would defeat the point of this prototype.
    console.error('JWT_SECRET is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  await connectDB(MONGODB_URI);
  console.log('mongo connected');

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('failed to start:', err.message);
  process.exit(1);
});
