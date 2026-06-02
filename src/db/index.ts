import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

const pool = new Pool({ connectionString: serverEnv().DATABASE_URL });

export const db = drizzle(pool, { schema });

export { schema };
export * from "./schema";
