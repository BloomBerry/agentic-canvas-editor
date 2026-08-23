/**
 * Side-effect import that loads .env and config.env BEFORE any other module
 * is imported. This MUST be the very first import in app.ts.
 *
 * Why this exists: ES/CJS imports are hoisted, so a `dotenv.config()` call
 * placed below `import { ... }` runs after the imported modules' top-level
 * code has already executed. Modules like batch_toggle.ts that read
 * process.env at module-load time would then see undefined values.
 * Loading dotenv via a dedicated module that is itself the first imported
 * dependency guarantees process.env is populated before sibling imports
 * read from it.
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../config.env") });
