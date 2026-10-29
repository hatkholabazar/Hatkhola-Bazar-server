"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminAuthLimiter = exports.adminRateLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
exports.adminRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // Limit each IP to 300 requests per 15 mins for administrative tasks
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many administrative requests from this IP, please try again after 15 minutes',
    },
    skip: () => process.env.NODE_ENV === 'test', // Do not throttle automated tests
});
exports.adminAuthLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 15, // Limit login attempts to 15 per 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many authentication attempts, please try again later',
    },
    skip: () => process.env.NODE_ENV === 'test',
});
