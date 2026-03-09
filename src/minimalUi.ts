import type {
  AppClientChatMessage,
  AppClientConnectionStatus,
} from "../electron/appClientState.js";

export const COMPACT_CHAT_LOG_LIMIT = 10;

export const shouldExpandConnectionControls = (
  status: AppClientConnectionStatus,
) => status !== "connected";

export const getCompactChatLogMessages = (
  messages: AppClientChatMessage[],
  limit = COMPACT_CHAT_LOG_LIMIT,
) => messages.slice(Math.max(messages.length - limit, 0));
