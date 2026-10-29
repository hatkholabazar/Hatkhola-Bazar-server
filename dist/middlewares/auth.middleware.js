"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdminAuth = requireAdminAuth;
function requireAdminAuth(req, res, next) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@hatkholabazar.com';
    const adminSecret = process.env.ADMIN_API_SECRET;
    const authHeader = req.headers.authorization;
    const secretHeader = req.headers['x-admin-secret'];
    const emailHeader = req.headers['x-admin-email'];
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
    }
    // Allow if secret token matches
    if (adminSecret && (token === adminSecret || secretHeader === adminSecret)) {
        req.adminEmail = adminEmail;
        return next();
    }
    // Allow if header email matches ADMIN_EMAIL and secret is provided or in dev
    if (emailHeader && emailHeader.toLowerCase() === adminEmail.toLowerCase()) {
        if (!adminSecret || token === adminSecret || secretHeader === adminSecret || process.env.NODE_ENV === 'test') {
            req.adminEmail = adminEmail;
            return next();
        }
    }
    // Also support authenticated test mock
    if (process.env.NODE_ENV === 'test' && (token === 'test_admin_token' || req.headers['x-test-admin'] === 'true')) {
        req.adminEmail = adminEmail;
        return next();
    }
    return res.status(401).json({
        error: 'Unauthorized: Admin authentication required',
        message: 'Only authorized administrator email can access private admin API',
    });
}
