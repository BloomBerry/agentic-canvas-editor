type LogEntry = {
    header: string;
    body?: string;
};
export declare const logger: {
    info: ({ header, body }: LogEntry) => boolean;
    debug: ({ header, body }: LogEntry) => boolean;
    warn: ({ header, body }: LogEntry) => boolean;
    error: ({ header, body }: LogEntry) => boolean;
    log: ({ header, body }: LogEntry) => boolean;
};
export declare const serverUrl: string;
export declare const WS_URL: string;
export declare const SERVER_CONFIG: {
    name: string;
    version: string;
    defaultWebSocketPort: number;
    reconnectDelay: number;
    requestTimeout: number;
    extendedTimeout: number;
    importTimeout: number;
};
export {};
