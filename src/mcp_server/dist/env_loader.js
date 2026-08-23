/**
 * Side-effect import that loads config.env BEFORE any other module is
 * imported. This MUST be the very first import in server.ts.
 *
 * Why this exists: ES imports are hoisted, so a `dotenv.config()` call
 * placed below `import { ... }` runs after the imported modules' top-level
 * code has already executed. Modules like batchTools.ts (or any future
 * env-driven feature flag) would then see undefined values. Loading dotenv
 * via a dedicated module that is itself the first imported dependency
 * guarantees process.env is populated before sibling imports read from it.
 */
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// dist/env_loader.js sits 3 levels below the project root that holds config.env.
dotenv.config({ path: resolve(__dirname, "../../../config.env") });
