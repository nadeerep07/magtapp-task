// The account.

const mongoose = require('mongoose');

// No isPro, no tier, no status — entitlement is derived (see services/entitlement.js).
const userSchema = new mongoose.Schema(
  {
    // Unique because restore-on-new-device needs one human to map to one account.
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
