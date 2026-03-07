export {};

declare global {
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

  interface Window {
    app?: {
      versions: NodeJS.ProcessVersions;
      platform: NodeJS.Platform;
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
