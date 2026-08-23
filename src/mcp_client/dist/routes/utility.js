"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectChannel = exports.importJson = exports.exportJson = exports.getChannels = exports.deleteAllTopLevelNodes = void 0;
const crypto_1 = require("crypto");
const types_1 = require("../types");
const session_1 = require("../core/session");
const helpers_1 = require("../utils/helpers");
const validateTools = (res) => {
    if (!session_1.globalSession.state.tools) {
        res.status(400).json({
            status: types_1.ResponseStatus.ERROR,
            message: "Tools are not initialized in the session",
        });
        return false;
    }
    return true;
};
const deleteAllTopLevelNodes = async (req, res) => {
    try {
        if (!validateTools(res))
            return;
        const toolCall = session_1.globalSession.state.tools.createToolCall("clear_canvas", (0, crypto_1.randomUUID)());
        const result = await session_1.globalSession.state.tools.callTool(toolCall);
        if (result.isError) {
            res.status(500).json({
                status: types_1.ResponseStatus.ERROR,
                message: "Failed to clear canvas",
            });
            return;
        }
        res.json({
            status: types_1.ResponseStatus.SUCCESS,
            message: "Canvas cleared successfully",
        });
    }
    catch (error) {
        helpers_1.logger.error({
            header: "Error in deleteAllTopLevelNodes",
            body: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({
            status: types_1.ResponseStatus.ERROR,
            message: String(error),
        });
    }
};
exports.deleteAllTopLevelNodes = deleteAllTopLevelNodes;
const getChannels = async (req, res) => {
    try {
        if (!validateTools(res))
            return;
        const getChannelsToolCall = session_1.globalSession.state.tools.createToolCall("get_channels", (0, crypto_1.randomUUID)());
        const result = await session_1.globalSession.state.tools.callTool(getChannelsToolCall);
        if (result.isError || !result.content) {
            res.status(500).json({
                status: types_1.ResponseStatus.ERROR,
                message: "Invalid response from tool",
            });
            return;
        }
        const channelList = result.structuredContent?.availableChannels || [];
        const currentChannel = result.structuredContent?.currentChannel || null;
        if (!Array.isArray(channelList) || channelList.length === 0) {
            res.status(500).json({
                status: types_1.ResponseStatus.ERROR,
                message: "No channel information found",
            });
            return;
        }
        res.json({
            status: types_1.ResponseStatus.SUCCESS,
            payload: {
                available_channels: channelList,
                current_channel: currentChannel,
            },
        });
    }
    catch (error) {
        helpers_1.logger.error({
            header: "Error in getChannels",
            body: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({
            status: types_1.ResponseStatus.ERROR,
            message: String(error),
        });
    }
};
exports.getChannels = getChannels;
const exportJson = async (req, res) => {
    try {
        if (!validateTools(res))
            return;
        const toolCall = session_1.globalSession.state.tools.createToolCall("export_json", (0, crypto_1.randomUUID)());
        const result = await session_1.globalSession.state.tools.callTool(toolCall);
        if (result.isError) {
            res.status(500).json({
                status: types_1.ResponseStatus.ERROR,
                message: "Failed to export JSON from Figma",
            });
            return;
        }
        res.json({
            status: types_1.ResponseStatus.SUCCESS,
            payload: result.structuredContent ?? {},
        });
    }
    catch (error) {
        helpers_1.logger.error({
            header: "Error in exportJson",
            body: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({
            status: types_1.ResponseStatus.ERROR,
            message: String(error),
        });
    }
};
exports.exportJson = exportJson;
const importJson = async (req, res) => {
    try {
        const jsonString = req.body.jsonString;
        if (!jsonString) {
            res.status(400).json({
                status: types_1.ResponseStatus.ERROR,
                message: "jsonString is required in request body",
            });
            return;
        }
        if (!validateTools(res))
            return;
        const toolArgs = { jsonString };
        // Forward optional imageData (imageRef → base64 PNG mapping)
        if (req.body.imageData && typeof req.body.imageData === "object") {
            toolArgs.imageData = req.body.imageData;
        }
        const toolCall = session_1.globalSession.state.tools.createToolCall("import_json", (0, crypto_1.randomUUID)(), toolArgs);
        const result = await session_1.globalSession.state.tools.callTool(toolCall);
        if (result.isError) {
            const errorDetail = result.content
                ?.filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("; ") || "Unknown error";
            res.status(500).json({
                status: types_1.ResponseStatus.ERROR,
                message: `Failed to import JSON into Figma: ${errorDetail}`,
            });
            return;
        }
        res.json({
            status: types_1.ResponseStatus.SUCCESS,
            payload: result.structuredContent ?? {},
        });
    }
    catch (error) {
        helpers_1.logger.error({
            header: "Error in importJson",
            body: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({
            status: types_1.ResponseStatus.ERROR,
            message: String(error),
        });
    }
};
exports.importJson = importJson;
const selectChannel = async (req, res) => {
    try {
        const channel = req.query.channel || req.body.channel;
        if (!channel) {
            res.status(400).json({
                status: types_1.ResponseStatus.ERROR,
                message: "channel is required",
            });
            return;
        }
        if (!validateTools(res))
            return;
        const toolCall = session_1.globalSession.state.tools.createToolCall("select_channel", (0, crypto_1.randomUUID)(), { channel });
        const result = await session_1.globalSession.state.tools.callTool(toolCall);
        if (result.isError || !result.structuredContent?.channel) {
            res.status(500).json({
                status: types_1.ResponseStatus.ERROR,
                message: "Invalid response from tool",
            });
            return;
        }
        res.json({
            status: types_1.ResponseStatus.SUCCESS,
            message: `Switched to channel: ${result.structuredContent.channel}`,
        });
    }
    catch (error) {
        helpers_1.logger.error({
            header: "Error in selectChannel",
            body: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({
            status: types_1.ResponseStatus.ERROR,
            message: String(error),
        });
    }
};
exports.selectChannel = selectChannel;
//# sourceMappingURL=utility.js.map