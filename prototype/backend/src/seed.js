// Inserts the featureConfig rows. Run before demoing: npm run seed

require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB } = require('./config/db');
const FeatureConfig = require('./models/featureConfig');

// These two rows are the entire free/paid policy; no route or middleware hardcodes it.
const FEATURES = [
  {
    key: 'translate',
    requiredTier: 'free',
    freeLimit: 5,
  },
  {
    // null freeLimit means no allowance at all: 403 on the first call, not the sixth.
    key: 'documents',
    requiredTier: 'pro',
    freeLimit: null,
  },
];

// Upsert so re-running is safe; a seed that crashes twice is a seed people skip.
async function seed() {
  await connectDB(process.env.MONGODB_URI);

  for (const feature of FEATURES) {
    await FeatureConfig.findOneAndUpdate(
      { key: feature.key },
      { $set: feature },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(
      `seeded ${feature.key} (tier=${feature.requiredTier}, freeLimit=${feature.freeLimit})`
    );
  }

  await mongoose.disconnect();
  console.log('done');
}

seed().catch((err) => {
  console.error('seed failed:', err.message);
  process.exit(1);
});
