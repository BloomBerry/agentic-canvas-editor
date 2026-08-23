import { Request, Response } from "express";
import { ResponseData } from "../types";
export declare const deleteAllTopLevelNodes: (req: Request, res: Response<ResponseData>) => Promise<void>;
export declare const getChannels: (req: Request, res: Response<ResponseData>) => Promise<void>;
export declare const exportJson: (req: Request, res: Response<ResponseData>) => Promise<void>;
export declare const importJson: (req: Request, res: Response<ResponseData>) => Promise<void>;
export declare const selectChannel: (req: Request, res: Response<ResponseData>) => Promise<void>;
//# sourceMappingURL=utility.d.ts.map