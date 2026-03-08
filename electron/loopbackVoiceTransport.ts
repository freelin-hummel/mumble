import {
  SecureVoiceClient,
  createSecureVoiceDemoServer,
  type SecureVoiceDemoServer
} from "./secureVoice.js";
import type {
  UdpVoiceTransportBinaryPayload,
  UdpVoiceTransportPacket,
  UdpVoiceTransportStatus
} from "./udpVoiceTransport.js";

export type LoopbackVoiceTransportConnectOptions = {
  username: string;
  password?: string;
};

type MessageListener = (packet: UdpVoiceTransportPacket) => void;
type StatusListener = (status: UdpVoiceTransportStatus) => void;

const CIPHER_SUITE = "AES-256-GCM / X25519 / HKDF-SHA256";
const MAX_VOICE_PACKET_BYTES = 2048;

const normalizePayload = (payload: UdpVoiceTransportBinaryPayload): Uint8Array => {
  const normalized = payload instanceof ArrayBuffer
    ? new Uint8Array(payload)
    : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);

  if (normalized.byteLength === 0) {
    throw new Error("Voice packet payload must not be empty");
  }

  if (normalized.byteLength > MAX_VOICE_PACKET_BYTES) {
    throw new Error(`Voice packet payload exceeds ${MAX_VOICE_PACKET_BYTES} bytes`);
  }

  return normalized;
};

const createDisconnectedStatus = (): UdpVoiceTransportStatus => ({
  state: "disconnected",
  remoteAddress: null,
  remotePort: null,
  localAddress: null,
  localPort: null,
  lastError: null,
  lastSentAt: null,
  lastReceivedAt: null,
  transportMode: "secure-loopback",
  sessionId: null,
  cipherSuite: null,
  packetsSent: 0,
  packetsReceived: 0,
  packetLoss: 0,
  averageRoundTripMs: null
});

const calculatePacketLoss = (packetsSent: number, packetsReceived: number) => {
  if (packetsSent <= 0) {
    return 0;
  }

  return Math.round(((packetsSent - packetsReceived) / packetsSent) * 1000) / 10;
};

export class LoopbackVoiceTransport {
  private server: SecureVoiceDemoServer | null = null;
  private client: SecureVoiceClient | null = null;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private status: UdpVoiceTransportStatus = createDisconnectedStatus();
  private sendQueue: Promise<void> = Promise.resolve();

  public getStatus() {
    return { ...this.status };
  }

  public onMessage(listener: MessageListener) {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  public onStatusChange(listener: StatusListener) {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public async connect(options: LoopbackVoiceTransportConnectOptions) {
    const username = options.username.trim();
    if (!username) {
      throw new Error("Loopback voice transport requires a username");
    }

    const password = options.password ?? "voice-ready";
    await this.disconnect();

    this.updateStatus({
      ...createDisconnectedStatus(),
      state: "connecting"
    });

    try {
      const server = await createSecureVoiceDemoServer({
        users: {
          [username]: password
        },
        echoTransform: (payload) => Buffer.from(payload)
      });
      const client = await SecureVoiceClient.connect({
        host: server.address.host,
        tcpPort: server.address.tcpPort,
        username,
        password
      });

      this.server = server;
      this.client = client;
      this.updateStatus({
        state: "connected",
        remoteAddress: server.address.host,
        remotePort: server.address.udpPort,
        localAddress: null,
        localPort: null,
        lastError: null,
        lastSentAt: null,
        lastReceivedAt: null,
        transportMode: "secure-loopback",
        sessionId: client.info.sessionId,
        cipherSuite: CIPHER_SUITE,
        packetsSent: 0,
        packetsReceived: 0,
        packetLoss: 0,
        averageRoundTripMs: null
      });
    } catch (error) {
      await this.disconnect();
      const message = error instanceof Error ? error.message : String(error);
      this.updateStatus({
        ...createDisconnectedStatus(),
        lastError: message
      });
      throw error;
    }

    return this.getStatus();
  }

  public async send(payload: UdpVoiceTransportBinaryPayload) {
    const normalized = normalizePayload(payload);
    const queuedSend = this.sendQueue.then(() => this.sendNow(normalized));
    this.sendQueue = queuedSend.then(() => undefined, () => undefined);
    return queuedSend;
  }

  public async disconnect() {
    const client = this.client;
    const server = this.server;
    this.client = null;
    this.server = null;
    this.sendQueue = Promise.resolve();

    await Promise.allSettled([
      client?.close(),
      server?.close()
    ]);

    this.updateStatus(createDisconnectedStatus());
    return this.getStatus();
  }

  private async sendNow(payload: Uint8Array) {
    const client = this.client;
    const server = this.server;
    if (!client || !server || this.status.state !== "connected") {
      throw new Error("Voice packet payload cannot be sent before the secure loopback session is connected");
    }

    const sentAt = Date.now();
    const nextPacketsSent = (this.status.packetsSent ?? 0) + 1;
    this.updateStatus({
      packetsSent: nextPacketsSent,
      lastSentAt: sentAt,
      packetLoss: calculatePacketLoss(nextPacketsSent, this.status.packetsReceived ?? 0)
    });

    try {
      const echoedPayload = await client.roundTripVoiceFrame(payload);
      const receivedAt = Date.now();
      const nextPacketsReceived = (this.status.packetsReceived ?? 0) + 1;
      const previousAverage = this.status.averageRoundTripMs;
      const nextAverage = previousAverage === null
        ? receivedAt - sentAt
        : Math.round((((previousAverage * (nextPacketsReceived - 1)) + (receivedAt - sentAt)) / nextPacketsReceived) * 10) / 10;

      this.updateStatus({
        packetsReceived: nextPacketsReceived,
        packetLoss: calculatePacketLoss(nextPacketsSent, nextPacketsReceived),
        averageRoundTripMs: nextAverage,
        lastReceivedAt: receivedAt,
        lastError: null
      });

      this.emitMessage({
        payload: new Uint8Array(echoedPayload),
        remoteAddress: server.address.host,
        remotePort: server.address.udpPort,
        receivedAt
      });

      return payload.byteLength;
    } catch (error) {
      this.updateStatus({
        lastError: error instanceof Error ? error.message : String(error),
        packetLoss: calculatePacketLoss(nextPacketsSent, this.status.packetsReceived ?? 0)
      });
      throw error;
    }
  }

  private emitMessage(packet: UdpVoiceTransportPacket) {
    for (const listener of this.messageListeners) {
      listener(packet);
    }
  }

  private updateStatus(status: UdpVoiceTransportStatus) {
    this.status = { ...this.status, ...status };
    const nextStatus = this.getStatus();
    for (const listener of this.statusListeners) {
      listener(nextStatus);
    }
  }
}
