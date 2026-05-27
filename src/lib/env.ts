import { z } from "zod";

const serverSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  DATABASE_URL: z.string().url(),
  FX_API_BASE: z.string().url().default("https://api.exchangerate.host"),
});

const clientSchema = z.object({
  NEXT_PUBLIC_MINI_APP_URL: z.string().url(),
});

type ServerEnv = z.infer<typeof serverSchema>;
type ClientEnv = z.infer<typeof clientSchema>;

let _server: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (_server) return _server;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server env: ${issues}`);
  }
  _server = parsed.data;
  return _server;
}

export const clientEnv: ClientEnv = clientSchema.parse({
  NEXT_PUBLIC_MINI_APP_URL: process.env.NEXT_PUBLIC_MINI_APP_URL,
});
