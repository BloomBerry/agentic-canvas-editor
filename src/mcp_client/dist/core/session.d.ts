import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ServerStatus } from "../types";
import { Tools } from "./tools";
export interface SessionState {
    client: Client | null;
    transport: StdioClientTransport | null;
    tools: Tools | null;
    status: ServerStatus;
}
export declare class Session {
    state: SessionState;
    constructor();
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
}
export declare const globalSession: Session;
//# sourceMappingURL=session.d.ts.map