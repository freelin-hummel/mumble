import { EventEmitter, once } from "node:events";
import { Socket, isIP } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import { ProtobufFramer } from "./framer.js";
import type { ProtobufControlMessage } from "./types.js";

export interface TCPControlChannelConnectOptions {
  host: string;
  port: number;
  secure?: boolean;
  rejectUnauthorized?: boolean;
  servername?: string;
}

export interface TCPControlChannelEvents {
  connect: [];
  close: [hadError: boolean];
  error: [error: Error];
  message: [message: ProtobufControlMessage];
}

export class TCPControlChannel extends EventEmitter<TCPControlChannelEvents> {
  readonly #framer: ProtobufFramer;
  readonly #socketFactory: () => Socket;
  #socket: Socket | TLSSocket | null = null;

  constructor(
    socketFactory: () => Socket = () => new Socket(),
    framer: ProtobufFramer = new ProtobufFramer()
  ) {
    super();
    this.#socketFactory = socketFactory;
    this.#framer = framer;
  }

  get connected(): boolean {
    const socket = this.#socket;
    return socket !== null && !socket.destroyed && socket.writable;
  }

  async connect(options: TCPControlChannelConnectOptions): Promise<void> {
    if (this.connected) {
      throw new Error("The TCP control channel is already connected.");
    }

    const socket = options.secure
      ? connectTls({
        host: options.host,
        port: options.port,
        rejectUnauthorized: options.rejectUnauthorized ?? true,
        servername: options.servername ?? (isIP(options.host) === 0 ? options.host : undefined)
      })
      : this.#socketFactory();
    this.#socket = socket;
    this.#framer.reset();

    await new Promise<void>((resolve, reject) => {
      const handleConnect = () => {
        cleanup();
        this.#bindSocket(socket);
        this.emit("connect");
        resolve();
      };

      const handleError = (error: Error) => {
        cleanup();
        this.#socket = null;
        reject(error);
      };

      const handleClose = () => {
        cleanup();
        this.#socket = null;
        reject(new Error("The TCP control channel closed before it connected."));
      };

      const cleanup = () => {
        socket.off(options.secure ? "secureConnect" : "connect", handleConnect);
        socket.off("error", handleError);
        socket.off("close", handleClose);
      };

      socket.once(options.secure ? "secureConnect" : "connect", handleConnect);
      socket.once("error", handleError);
      socket.once("close", handleClose);

      if (!options.secure) {
        socket.connect({
          host: options.host,
          port: options.port
        });
      }
    });
  }

  async disconnect(): Promise<void> {
    const socket = this.#socket;

    if (!socket || socket.destroyed) {
      this.#socket = null;
      this.#framer.reset();
      return;
    }

    const closePromise = once(socket, "close").then(() => undefined);
    socket.end();
    await closePromise;
  }

  async send(message: ProtobufControlMessage): Promise<void> {
    const socket = this.#socket;

    if (!socket || socket.destroyed || !socket.writable) {
      throw new Error("The TCP control channel is not connected.");
    }

    const frame = this.#framer.encode(message);

    await new Promise<void>((resolve, reject) => {
      socket.write(frame, (error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  #bindSocket(socket: Socket | TLSSocket): void {
    socket.on("data", (chunk) => {
      try {
        for (const message of this.#framer.push(chunk)) {
          this.emit("message", message);
        }
      } catch (error) {
        socket.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    });

    socket.on("error", (error) => {
      this.emit("error", error);
    });

    socket.on("close", (hadError) => {
      if (this.#socket === socket) {
        this.#socket = null;
      }

      this.#framer.reset();
      this.emit("close", hadError);
    });
  }
}
