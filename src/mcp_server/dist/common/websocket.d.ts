import WebSocket from "ws";
import { FigmaCommand } from "../types.js";
export declare function getWebSocket(): WebSocket | null;
export declare function getCurrentChannel(): string | null;
export declare function connectToFigma(port?: number): void;
export declare function sendCommandToFigma(command: FigmaCommand, params?: unknown, timeoutMs?: number): Promise<any>;
