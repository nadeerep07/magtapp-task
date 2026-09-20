// Verifies the JWT and attaches req.user. Identity only, never entitlement.

const jwt = require('jsonwebtoken');
const { ApiError } = require('./errorHandler');

// The token carries only the user id: a tier claim would survive cancellation
// until the token expired, and lag behind a purchase until the next sign-in.
function auth(req, res, next) {
  const header = req.headers.authorization || '';

  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(
      new ApiError('UNAUTHORIZED', 'Missing or malformed Authorization header.')
    );
  }

  try {
    // Checking the signature against JWT_SECRET is why a forged token fails.
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch (err) {
    // Reason withheld: it helps an attacker probe and the fix is the same anyway.
    return next(new ApiError('UNAUTHORIZED', 'Invalid or expired token.'));
  }
}

module.exports = auth;
