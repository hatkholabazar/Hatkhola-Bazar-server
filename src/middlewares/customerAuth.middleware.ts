import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';

export interface CustomerAuthUser {
  id: string;
  email: string;
  name: string;
}

export interface CustomerAuthRequest extends Request {
  user?: CustomerAuthUser;
}

export async function requireCustomerAuth(
  req: CustomerAuthRequest,
  res: Response,
  next: NextFunction
) {
  // Test environment mock support
  if (process.env.NODE_ENV === 'test' && req.headers['x-test-user-id']) {
    req.user = {
      id: String(req.headers['x-test-user-id']),
      email: String(req.headers['x-test-user-email'] || 'test@example.com'),
      name: String(req.headers['x-test-user-name'] || 'Test Customer'),
    };
    return next();
  }

  // 1. Extract session token from cookies or authorization header
  let token: string | undefined = undefined;

  if (req.cookies) {
    token =
      req.cookies['better-auth.session_token'] ||
      req.cookies['__Secure-better-auth.session_token'] ||
      req.cookies['better-auth.session'] ||
      req.cookies['better-auth.session_data'];
  }

  // Also check raw cookie header in case cookie-parser didn't parse dot-notated cookies
  if (!token && req.headers.cookie) {
    const rawCookies = req.headers.cookie.split(';');
    for (const c of rawCookies) {
      const trimmed = c.trim();
      if (
        trimmed.startsWith('better-auth.session_token=') ||
        trimmed.startsWith('__Secure-better-auth.session_token=') ||
        trimmed.startsWith('better-auth.session=')
      ) {
        token = decodeURIComponent(trimmed.split('=')[1]);
        break;
      }
    }
  }

  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }

  if (!token && req.headers['x-session-token']) {
    token = String(req.headers['x-session-token']).trim();
  }

  if (!token) {
    // If request contains phone identifier, allow read-only customer lookup
    if (req.query?.phone || req.body?.phone) {
      return next();
    }
    return res.status(401).json({
      error: 'Unauthorized: Active user session required',
    });
  }

  try {
    const db = mongoose.connection.db;
    if (!db) {
      return res.status(503).json({ error: 'Database service unavailable' });
    }

    // Strip signature if token was obtained from a signed cookie (e.g. "token.signature")
    const rawToken = token.includes('.') ? token.slice(0, token.lastIndexOf('.')) : token;

    // 2. Query session table
    const session = await db.collection('session').findOne({
      $or: [{ token }, { token: rawToken }],
    });
    if (!session) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      return res.status(401).json({ error: 'Session expired' });
    }

    // 3. Query user table
    const userIdObj =
      typeof session.userId === 'string'
        ? session.userId
        : session.userId?.toString();

    let user = await db.collection('user').findOne({ id: userIdObj });
    if (!user) {
      // Try by MongoDB ObjectId
      try {
        user = await db.collection('user').findOne({
          _id: new mongoose.Types.ObjectId(userIdObj),
        });
      } catch {
        // Not a valid ObjectId
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'User record not found' });
    }

    req.user = {
      id: user.id || user._id.toString(),
      email: user.email,
      name: user.name || 'Customer',
    };

    return next();
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to verify user session' });
  }
}

