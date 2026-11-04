import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4301),
  APP_ORIGIN: z.url().default('http://localhost:4200'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  TRUST_PROXY: z.enum(['true','false']).optional(),
  SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  NEOGEO_PROJECT_DIR: z.string().optional(),
  CRASH_PROJECT_DIR: z.string().optional(),
  CRASH_HOST_USERNAME: z.string().trim().toLowerCase().optional(),
  CRASH_SBI_PATH: z.string().optional(),
  CTR_GAME_PATH: z.string().optional(),
  CTR_SBI_PATH: z.string().optional(),
  TURN_SHARED_SECRET: z.string().optional(),
  RTC_ICE_SERVERS: z.string().max(12000).optional(),
});
export type Config = z.infer<typeof envSchema>;
export const readConfig = (): Config => envSchema.parse(process.env);
