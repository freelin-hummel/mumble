import type {
  AppClientChannel,
  AppClientTelemetry
} from "../electron/appClientState.js";
import type { UdpVoiceTransportStatus } from "../electron/udpVoiceTransport.js";
import type { VoiceActivationState } from "./voiceActivation";

export const findNextNavigableChannel = (
  channels: readonly AppClientChannel[],
  activeChannelId: string | null
) => {
  const enterableChannels = channels.filter((channel) => channel.permissions.enter);
  if (enterableChannels.length === 0) {
    return null;
  }

  if (!activeChannelId) {
    return enterableChannels[0] ?? null;
  }

  const activeIndex = enterableChannels.findIndex((channel) => channel.id === activeChannelId);
  if (activeIndex === -1) {
    return enterableChannels[0] ?? null;
  }

  if (enterableChannels.length === 1) {
    return null;
  }

  return enterableChannels[(activeIndex + 1) % enterableChannels.length] ?? null;
};

export const describeQuickActionLatency = (
  telemetry: AppClientTelemetry,
  transportStatus: UdpVoiceTransportStatus | null
) => {
  if (typeof telemetry.latencyMs === "number") {
    return `${telemetry.latencyMs} ms latency`;
  }

  if (transportStatus?.lastError) {
    return "Transport needs attention";
  }

  if (transportStatus?.state === "connected") {
    return "Transport ready · waiting for live metrics";
  }

  if (transportStatus?.state === "connecting") {
    return "Voice transport connecting…";
  }

  return "Waiting for live diagnostics";
};

export const describeTalkMode = ({
  pushToTalk,
  pushToTalkPressed,
  shortcutLabel,
  voiceActivation
}: {
  pushToTalk: boolean;
  pushToTalkPressed: boolean;
  shortcutLabel: string;
  voiceActivation: VoiceActivationState;
}) => {
  if (pushToTalk) {
    return pushToTalkPressed
      ? `Talking with ${shortcutLabel}`
      : `Hold ${shortcutLabel} to talk`;
  }

  if (voiceActivation.isTransmitting) {
    return "Voice activation is live";
  }

  return "Voice activation is armed";
};

export const describeTransportStatus = (transportStatus: UdpVoiceTransportStatus | null) => {
  if (!transportStatus) {
    return "Renderer transport unavailable";
  }

  if (transportStatus.lastError) {
    return `Error · ${transportStatus.lastError}`;
  }

  switch (transportStatus.state) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting…";
    default:
      return "Idle";
  }
};

export const formatTransportActivity = (transportStatus: UdpVoiceTransportStatus | null) => {
  if (!transportStatus) {
    return "Last packet: unavailable";
  }

  const lastActivity = transportStatus.lastReceivedAt ?? transportStatus.lastSentAt;
  if (!lastActivity) {
    return "Last packet: none yet";
  }

  return `Last packet: ${new Date(lastActivity).toLocaleTimeString()}`;
};
