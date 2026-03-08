import dgram, { type RemoteInfo, type Socket } from "node:dgram";
import { type AddressInfo } from "node:net";

export interface UdpVoiceTransportConnectOptions {
  host: string;
  port: number;
  bindAddress?: string;
  bindPort?: number;
}

export interface UdpVoiceTransportStatus {
  state: "disconnected" | "connecting" | "connected";
  remoteAddress: string | null;
  remotePort: number | null;
  localAddress: string | null;
  localPort: number | null;
  lastError: string | null;
  lastSentAt: number | null;
  lastReceivedAt: number | null;
  transportMode?: "udp" | "secure-loopback";
  sessionId?: string | null;
  cipherSuite?: string | null;
  packetsSent?: number;
  packetsReceived?: number;
  packetLoss?: number | null;
  averageRoundTripMs?: number | null;
}

export interface UdpVoiceTransportPacket {
  payload: Uint8Array;
  remoteAddress: string;
  remotePort: number;
  receivedAt: number;
}

export type UdpVoiceTransportBinaryPayload = ArrayBuffer | ArrayBufferView;

const DEFAULT_BIND_ADDRESS = "0.0.0.0";
const MAX_VOICE_PACKET_BYTES = 2048;
const MAX_PORT = 65_535;

type SocketFactory = () => Socket;
type MessageListener = (packet: UdpVoiceTransportPacket) => void;
type StatusListener = (status: UdpVoiceTransportStatus) => void;

const isValidPort = (value: number, allowZero = false) =>
  Number.isInteger(value) && value >= (allowZero ? 0 : 1) && value <= MAX_PORT;

const toAddressInfo = (socket: Socket): AddressInfo => {
  const address = socket.address();
  if (typeof address === "string") {
    throw new Error("Unix sockets are not supported for UDP voice transport");
  }

  return address;
};

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

export class UdpVoiceTransport {
  private socket: Socket | null = null;
  private readonly createSocket: SocketFactory;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private status: UdpVoiceTransportStatus = {
    state: "disconnected",
    remoteAddress: null,
    remotePort: null,
    localAddress: null,
    localPort: null,
    lastError: null,
    lastSentAt: null,
    lastReceivedAt: null
  };

  constructor(createSocket: SocketFactory = () => dgram.createSocket("udp4")) {
    this.createSocket = createSocket;
  }

  getStatus() {
    return { ...this.status };
  }

  onMessage(listener: MessageListener) {
    this.messageListeners.add(listener);

    return () => {
      this.messageListeners.delete(listener);
    };
  }

  onStatusChange(listener: StatusListener) {
    this.statusListeners.add(listener);

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  async connect(options: UdpVoiceTransportConnectOptions) {
    const host = options.host.trim();
    if (!host) {
      throw new Error("UDP voice transport requires a host");
    }

    if (!isValidPort(options.port)) {
      throw new Error("UDP voice transport requires a valid remote port");
    }

    if (options.bindPort != null && !isValidPort(options.bindPort, true)) {
      throw new Error("UDP voice transport requires a valid local bind port");
    }

    await this.disconnect();

    const socket = this.createSocket();
    this.socket = socket;
    this.attachSocketListeners(socket);

    this.updateStatus({
      state: "connecting",
      remoteAddress: host,
      remotePort: options.port,
      localAddress: null,
      localPort: null,
      lastError: null,
      lastSentAt: null,
      lastReceivedAt: null
    });

    try {
      await this.bindSocket(socket, options.bindPort ?? 0, options.bindAddress ?? DEFAULT_BIND_ADDRESS);
      await this.connectSocket(socket, options.port, host);

      const address = toAddressInfo(socket);
      this.updateStatus({
        state: "connected",
        remoteAddress: host,
        remotePort: options.port,
        localAddress: address.address,
        localPort: address.port,
        lastError: null
      });
    } catch (error) {
      this.updateStatus({
        state: "disconnected",
        remoteAddress: null,
        remotePort: null,
        localAddress: null,
        localPort: null,
        lastError: error instanceof Error ? error.message : String(error),
        lastSentAt: null,
        lastReceivedAt: null
      });

      await this.closeSocket(socket);
      throw error;
    }

    return this.getStatus();
  }

  async send(payload: UdpVoiceTransportBinaryPayload) {
    const socket = this.socket;
    if (!socket || this.status.state !== "connected") {
      throw new Error("UDP voice transport is not connected");
    }

    const normalized = normalizePayload(payload);

    const sentBytes = await new Promise<number>((resolve, reject) => {
      socket.send(normalized, (error, bytes) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(bytes);
      });
    });

    this.updateStatus({
      lastSentAt: Date.now(),
      lastError: null
    });

    return sentBytes;
  }

  async disconnect() {
    const socket = this.socket;
    if (!socket) {
      if (this.status.state !== "disconnected") {
        this.updateStatus({
          state: "disconnected",
          remoteAddress: null,
          remotePort: null,
          localAddress: null,
          localPort: null,
          lastError: null,
          lastSentAt: null,
          lastReceivedAt: null
        });
      }

      return this.getStatus();
    }

    this.socket = null;
    await this.closeSocket(socket);
    this.updateStatus({
      state: "disconnected",
      remoteAddress: null,
      remotePort: null,
      localAddress: null,
      localPort: null,
      lastError: null,
      lastSentAt: null,
      lastReceivedAt: null
    });

    return this.getStatus();
  }

  private attachSocketListeners(socket: Socket) {
    socket.on("message", (message: Buffer, remoteInfo: RemoteInfo) => {
      const packet: UdpVoiceTransportPacket = {
        payload: new Uint8Array(message),
        remoteAddress: remoteInfo.address,
        remotePort: remoteInfo.port,
        receivedAt: Date.now()
      };

      this.updateStatus({
        lastReceivedAt: packet.receivedAt,
        lastError: null
      });

      for (const listener of this.messageListeners) {
        listener(packet);
      }
    });

    socket.on("error", (error: Error) => {
      this.updateStatus({
        lastError: error.message
      });
    });

    socket.on("close", () => {
      if (this.socket === socket) {
        this.socket = null;
      }
    });
  }

  private updateStatus(partial: Partial<UdpVoiceTransportStatus>) {
    this.status = {
      ...this.status,
      ...partial
    };

    const snapshot = this.getStatus();
    for (const listener of this.statusListeners) {
      listener(snapshot);
    }
  }

  private async bindSocket(socket: Socket, port: number, address: string) {
    await new Promise<void>((resolve, reject) => {
      const handleListening = () => {
        cleanup();
        resolve();
      };
      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        socket.off("listening", handleListening);
        socket.off("error", handleError);
      };

      socket.on("listening", handleListening);
      socket.on("error", handleError);
      socket.bind(port, address);
    });
  }

  private async connectSocket(socket: Socket, port: number, host: string) {
    await new Promise<void>((resolve, reject) => {
      socket.connect(port, host, (error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async closeSocket(socket: Socket) {
    await new Promise<void>((resolve) => {
      socket.close(() => {
        resolve();
      });
    });
  }
}
