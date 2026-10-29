import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5000'),
  CLIENT_URL: z.string().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z.string().optional(),
  ADMIN_EMAIL: z.string().email().default('admin@hatkholabazar.com'),
  ADMIN_API_SECRET: z.string().min(8).default('hatkhola-dev-admin-secret-2026'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // Pathao Courier
  PATHAO_BASE_URL: z.string().url().default('https://api-hermes.pathao.com'),
  PATHAO_CLIENT_ID: z.string().optional(),
  PATHAO_CLIENT_SECRET: z.string().optional(),
  PATHAO_USERNAME: z.string().optional(),
  PATHAO_PASSWORD: z.string().optional(),
  PATHAO_STORE_ID: z.string().optional(),
  PATHAO_ENV: z.enum(['sandbox', 'production']).default('production'),
  PATHAO_WEBHOOK_SECRET: z.string().optional(),
  PATHAO_WEBHOOK_INTEGRATION_SECRET: z
    .string()
    .default('f3992ecc-59da-4cbe-a049-a13da2018d51'),
  PATHAO_SYNC_ENABLED: z
    .string()
    .optional()
    .transform((val) => val === 'true')
    .default('false'),
  PUBLIC_TRACKING_ENABLED: z
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

export const env = parsed.success ? parsed.data : (process.env as any);

/**
 * Masks sensitive strings (e.g., client secrets, passwords, tokens)
 */
export function maskSecret(secret?: string, visibleChars = 4): string {
  if (!secret) return '***';
  if (secret.length <= visibleChars * 2) return '***';
  return `${secret.substring(0, visibleChars)}...${secret.substring(secret.length - visibleChars)}`;
}
