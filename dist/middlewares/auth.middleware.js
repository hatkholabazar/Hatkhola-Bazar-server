"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdminAuth = requireAdminAuth;
const mongoose_1 = __importDefault(require("mongoose"));
async function requireAdminAuth(req, res, next) {
    const adminSecret = process.env.ADMIN_API_SECRET;
    const authHeader = req.headers.authorization;
    const secretHeader = req.headers['x-admin-secret'];
    const emailHeader = req.headers['x-admin-email'];
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
    }
    // 1. Allow if secret token matches
    if (adminSecret && (token === adminSecret || secretHeader === adminSecret)) {
        try {
            const db = mongoose_1.default.connection.db;
            if (db) {
                const query = emailHeader
                    ? { email: emailHeader.toLowerCase().trim() }
                    : { role: 'admin' };
                const adminUser = await db.collection('user').findOne(query);
                if (adminUser?.email) {
                    req.adminEmail = adminUser.email;
                    return next();
                }
            }
        }
        catch {
            // Fall through to fallback
        }
        req.adminEmail = emailHeader || process.env.ADMIN_EMAIL || 'admin@hatkholabazar.com';
        return next();
    }
    // 2. Allow test admin mock in test environment
    if (process.env.NODE_ENV === 'test' && (token === 'test_admin_token' || req.headers['x-test-admin'] === 'true')) {
        req.adminEmail = emailHeader || process.env.ADMIN_EMAIL || 'admin@hatkholabazar.com';
        return next();
    }
    // 3. Dynamic database verification by email header if provided
    if (emailHeader) {
        try {
            const db = mongoose_1.default.connection.db;
            if (db) {
                const user = await db.collection('user').findOne({ email: emailHeader.toLowerCase().trim() });
                if (user && (user.role === 'admin' || user.isAdmin === true)) {
                    if (!adminSecret || token === adminSecret || secretHeader === adminSecret) {
                        req.adminEmail = user.email;
                        return next();
                    }
                }
            }
        }
        catch {
            // Fall through
        }
    }
    // 4. Check active Better Auth session if present in cookies or headers
    let sessionToken = undefined;
    if (req.cookies) {
        sessionToken =
            req.cookies['better-auth.session_token'] ||
                req.cookies['__Secure-better-auth.session_token'] ||
                req.cookies['better-auth.session'] ||
                req.cookies['better-auth.session_data'];
    }
    if (!sessionToken && req.headers.cookie) {
        const rawCookies = req.headers.cookie.split(';');
        for (const c of rawCookies) {
            const trimmed = c.trim();
            if (trimmed.startsWith('better-auth.session_token=') ||
                trimmed.startsWith('__Secure-better-auth.session_token=') ||
                trimmed.startsWith('better-auth.session=')) {
                sessionToken = decodeURIComponent(trimmed.split('=')[1]);
                break;
            }
        }
    }
    if (!sessionToken && token && token !== adminSecret) {
        sessionToken = token;
    }
    if (!sessionToken && req.headers['x-session-token']) {
        sessionToken = String(req.headers['x-session-token']).trim();
    }
    if (sessionToken) {
        try {
            const db = mongoose_1.default.connection.db;
            if (db) {
                const rawSessionToken = sessionToken.includes('.')
                    ? sessionToken.slice(0, sessionToken.lastIndexOf('.'))
                    : sessionToken;
                const session = await db.collection('session').findOne({
                    $or: [{ token: sessionToken }, { token: rawSessionToken }],
                });
                if (session && (!session.expiresAt || new Date(session.expiresAt) >= new Date())) {
                    const userIdObj = typeof session.userId === 'string' ? session.userId : session.userId?.toString();
                    let user = await db.collection('user').findOne({ id: userIdObj });
                    if (!user) {
                        try {
                            user = await db.collection('user').findOne({ _id: new mongoose_1.default.Types.ObjectId(userIdObj) });
                        }
                        catch {
                            // Ignore invalid ObjectId
                        }
                    }
                    // Dynamic admin check from database user record
                    if (user && (user.role === 'admin' || user.isAdmin === true)) {
                        req.adminEmail = user.email;
                        return next();
                    }
                }
            }
        }
        catch {
            // Fall through to 404
        }
    }
    // Conceal all admin routes from non-admins and scanners with a 404 Not Found
    return res.status(404).json({
        error: 'Not Found',
    });
}
