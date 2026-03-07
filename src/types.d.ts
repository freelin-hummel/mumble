export {};

declare global {
  type SecureVoiceSelfTestResult = {
    sessionId: string;
    echoedPayload: string;
    cipherSuite: string;
  };
  interface VoiceTransportStatus {
    state: "disconnected" | "connecting" | "connected";
    remoteAddress: string | null;
    remotePort: number | null;
    localAddress: string | null;
    localPort: number | null;
    lastError: string | null;
    lastSentAt: number | null;
    lastReceivedAt: number | null;
  }

  interface VoiceTransportPacket {
    payload: Uint8Array;
    remoteAddress: string;
    remotePort: number;
    receivedAt: number;
  }

  interface AppClientChannel {
    id: string;
    name: string;
    parentId: string | null;
    depth: number;
    position: number;
    permissions: {
      traverse: boolean;
      enter: boolean;
      speak: boolean;
      muteDeafen: boolean;
      move: boolean;
      write: boolean;
    };
    participantIds: string[];
  }

  interface AppClientParticipant {
    id: string;
    name: string;
    channelId: string;
    status: "live" | "muted" | "idle";
    isSelf?: boolean;
  }

  interface AppClientAudioSettings {
    inputDeviceId: string;
    outputDeviceId: string;
    captureEnabled: boolean;
    selfMuted: boolean;
    inputGain: number;
    outputGain: number;
  }

  interface AppClientPreferences {
    pushToTalk: boolean;
    pushToTalkShortcut: string;
    autoReconnect: boolean;
    notificationsEnabled: boolean;
    showLatencyDetails: boolean;
  }

  interface AppClientTelemetry {
    latencyMs: number | null;
    jitterMs: number | null;
    packetLoss: number | null;
  }

  interface AppClientConnectionState {
    status: "disconnected" | "connecting" | "connected" | "error";
    serverAddress: string;
    nickname: string;
    error: string | null;
  }

  interface AppClientState {
    connection: AppClientConnectionState;
    channels: AppClientChannel[];
    activeChannelId: string | null;
    participants: AppClientParticipant[];
    audio: AppClientAudioSettings;
    preferences: AppClientPreferences;
    telemetry: AppClientTelemetry;
    recentServers: string[];
  }

  interface Window {
    app?: {
      versions: NodeJS.ProcessVersions;
      platform: NodeJS.Platform;
      runSecureVoiceSelfTest?: () => Promise<SecureVoiceSelfTestResult>;
      getState?: () => Promise<AppClientState>;
      connect?: (options: { serverAddress: string; nickname: string }) => Promise<AppClientState>;
      disconnect?: () => Promise<AppClientState>;
      selectChannel?: (channelId: string) => Promise<AppClientState>;
      updateAudioSettings?: (audio: Partial<AppClientAudioSettings>) => Promise<AppClientState>;
      updatePreferences?: (preferences: Partial<AppClientPreferences>) => Promise<AppClientState>;
      onStateChanged?: (listener: (state: AppClientState) => void) => () => void;
    };
    voice?: {
      connect: (options: { host: string; port: number; bindAddress?: string; bindPort?: number }) => Promise<VoiceTransportStatus>;
      send: (payload: ArrayBuffer | ArrayBufferView) => Promise<number>;
      disconnect: () => Promise<VoiceTransportStatus>;
      getStatus: () => Promise<VoiceTransportStatus>;
      onMessage: (listener: (packet: VoiceTransportPacket) => void) => () => void;
      onStatus: (listener: (status: VoiceTransportStatus) => void) => () => void;
    };
  }
}
