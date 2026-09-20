// One error shape for the whole API, plus the helpers that produce it.

// Codes are the client's contract; messages are prose that can change freely.
const CODES = {
  UNAUTHORIZED: 401,
  PRO_REQUIRED: 403,
  FEATURE_LIMIT_REACHED: 429,
  RECEIPT_ALREADY_CLAIMED: 409,
  INVALID_RECEIPT: 422,
};

// Lets handlers throw and stop, instead of threading `res` through every branch.
class ApiError extends Error {
  constructor(code, message, details = {}, status = null) {
    super(message);
    this.code = code;
    this.details = details;
    // Derived from the code so one code always maps to one status.
    this.status = status || CODES[code] || 500;
  }
}

// Express 4 doesn't catch async errors; without this a throw hangs the request.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Four arguments is what marks this as an error handler to Express.
function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // Anything else is a bug: log it server-side, don't leak internals to the client.
  console.error('unhandled error:', err);

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong.',
      details: {},
    },
  });
}

module.exports = { ApiError, asyncHandler, errorHandler, CODES };
