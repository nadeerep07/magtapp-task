// Opens the MongoDB connection.

const mongoose = require('mongoose');

// Awaited before the HTTP port binds, so early requests can't hit a dead connection.
async function connectDB(uri) {
  // Off so a bad URI fails immediately instead of hanging until a query times out.
  mongoose.set('bufferCommands', false);
  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  });

  return mongoose.connection;
}

module.exports = { connectDB };
