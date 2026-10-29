"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
exports.maskSecret = maskSecret;
const zod_1 = require("zod");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const envSchema = zod_1.z.object({
    PORT: zod_1.z.string().default('5000'),
    CLIENT_URL: zod_1.z.string().default('http://localhost:3000'),
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    MONGODB_URI: zod_1.z.string().optional(),
    ADMIN_EMAIL: zod_1.z.string().email().default('admin@hatkholabazar.com'),
    ADMIN_API_SECRET: zod_1.z.string().min(8).default('hatkhola-dev-admin-secret-2026'),
    CLOUDINARY_CLOUD_NAME: zod_1.z.string().optional(),
    CLOUDINARY_API_KEY: zod_1.z.string().optional(),
    CLOUDINARY_API_SECRET: zod_1.z.string().optional(),
    // Pathao Courier
    PATHAO_BASE_URL: zod_1.z.string().url().default('https://api-hermes.pathao.com'),
    PATHAO_CLIENT_ID: zod_1.z.string().optional(),
    PATHAO_CLIENT_SECRET: zod_1.z.string().optional(),
    PATHAO_USERNAME: zod_1.z.string().optional(),
    PATHAO_PASSWORD: zod_1.z.string().optional(),
    PATHAO_STORE_ID: zod_1.z.string().optional(),
    PATHAO_ENV: zod_1.z.enum(['sandbox', 'production']).default('production'),
    PATHAO_WEBHOOK_SECRET: zod_1.z.string().optional(),
    PATHAO_WEBHOOK_INTEGRATION_SECRET: zod_1.z
        .string()
        .default('f3992ecc-59da-4cbe-a049-a13da2018d51'),
    PATHAO_SYNC_ENABLED: zod_1.z
        .string()
        .optional()
        .transform((val) => val === 'true')
        .default('false'),
    PUBLIC_TRACKING_ENABLED: zod_1.z
        .string()
        .optional()
        .transform((val) => val !== 'false')
        .default('true'),
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment variables:', parsed.error.format());
}
exports.env = parsed.success ? parsed.data : process.env;
/**
 * Masks sensitive strings (e.g., client secrets, passwords, tokens)
 */
function maskSecret(secret, visibleChars = 4) {
    if (!secret)
        return '***';
    if (secret.length <= visibleChars * 2)
        return '***';
    return `${secret.substring(0, visibleChars)}...${secret.substring(secret.length - visibleChars)}`;
}
