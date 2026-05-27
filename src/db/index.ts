import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

const client = neon(serverEnv().DATABASE_URL);

export const db = drizzle(client, { schema });

export { schema };
export * from "./schema";
