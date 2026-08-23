"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, "../../../.env") });
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, "../../../config.env") });
//# sourceMappingURL=env_loader.js.map