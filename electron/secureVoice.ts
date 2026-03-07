import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import { once } from "node:events";
import { createInterface, Interface } from "node:readline";
import { Socket, createServer } from "node:net";
import { createSocket, Socket as DgramSocket } from "node:dgram";

const CLIENT_PROOF_LABEL = Buffer.from("mumble-client-proof", "utf8");
const SERVER_PROOF_LABEL = Buffer.from("mumble-server-proof", "utf8");
const HKDF_INFO = Buffer.from("mumble-secure-voice", "utf8");
const DEFAULT_TIMEOUT_MS = 2_000;
const AUTH_TAG_BYTES = 16;
const SEQUENCE_BYTES = 8;
const NONCE_PREFIX_BYTES = 4;
const KEY_BYTES = 32;

type AuthInitMessage = {
  type: "auth-init";
  username: string;
  clientPublicKey: string;
  clientNonce: string;
  udpPort: number;
};

type AuthChallengeMessage = {
  type: "auth-challenge";
  salt: string;
  serverPublicKey: string;
  serverNonce: string;
  serverUdpPort: number;
};

type AuthProofMessage = {
  type: "auth-proof";
  proof: string;
};

type AuthOkMessage = {
  type: "auth-ok";
  sessionId: string;
  serverProof: string;
};

type AuthErrorMessage = {
  type: "auth-error";
  reason: string;
};

type HandshakeResponse = AuthChallengeMessage | AuthErrorMessage;
type FinalHandshakeResponse = AuthOkMessage | AuthErrorMessage;

type TransportSecrets = {
  clientKey: Buffer;
  serverKey: Buffer;
  clientNoncePrefix: Buffer;
  serverNoncePrefix: Buffer;
  aad: Buffer;
};

type SessionState = {
  sessionId: string;
  secrets: TransportSecrets;
  clientSequence: bigint;
  serverSequence: bigint;
};

export type SecureVoiceSelfTestResult = {
  sessionId: string;
  echoedPayload: string;
  cipherSuite: string;
};

export type SecureVoiceConnectionOptions = {
  host: string;
  tcpPort: number;
  username: string;
  password: string;
  timeoutMs?: number;
};

export type SecureVoiceClientInfo = {
  sessionId: string;
  remoteUdpPort: number;
};

export type SecureVoiceDemoServerOptions = {
  host?: string;
  tcpPort?: number;
  users: Record<string, string>;
  echoTransform?: (payload: Buffer) => Buffer;
};

export type SecureVoiceDemoServer = {
  readonly address: {
    host: string;
    tcpPort: number;
    udpPort: number;
  };
  readonly receivedVoiceFrames: Buffer[];
  readonly encryptedVoiceFrames: Buffer[];
  close(): Promise<void>;
};

function asBuffer(value: string) {
  return Buffer.from(value, "base64url");
}

function toBase64Url(buffer: Uint8Array) {
  return Buffer.from(buffer).toString("base64url");
}

function sha256(...parts: Array<Buffer | string>) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest();
}

function derivePasswordKey(password: string, salt: Buffer) {
  return scryptSync(password, salt, KEY_BYTES);
}

function transcriptHash(init: AuthInitMessage, challenge: AuthChallengeMessage) {
  return sha256(
    JSON.stringify({
      username: init.username,
      clientPublicKey: init.clientPublicKey,
      clientNonce: init.clientNonce,
      clientUdpPort: init.udpPort,
      serverPublicKey: challenge.serverPublicKey,
      serverNonce: challenge.serverNonce,
      serverUdpPort: challenge.serverUdpPort,
      salt: challenge.salt
    })
  );
}

function deriveProof(passwordKey: Buffer, label: Buffer, transcript: Buffer, sharedSecret: Buffer) {
  return createHmac("sha256", passwordKey).update(label).update(transcript).update(sharedSecret).digest();
}

function deriveTransportSecrets(sharedSecret: Buffer, init: AuthInitMessage, challenge: AuthChallengeMessage) {
  const salt = Buffer.concat([asBuffer(init.clientNonce), asBuffer(challenge.serverNonce)]);
  const material = Buffer.from(hkdfSync("sha256", sharedSecret, salt, HKDF_INFO, (KEY_BYTES * 2) + (NONCE_PREFIX_BYTES * 2) + 16));

  return {
    clientKey: material.subarray(0, KEY_BYTES),
    serverKey: material.subarray(KEY_BYTES, KEY_BYTES * 2),
    clientNoncePrefix: material.subarray(KEY_BYTES * 2, (KEY_BYTES * 2) + NONCE_PREFIX_BYTES),
    serverNoncePrefix: material.subarray((KEY_BYTES * 2) + NONCE_PREFIX_BYTES, (KEY_BYTES * 2) + (NONCE_PREFIX_BYTES * 2)),
    aad: material.subarray((KEY_BYTES * 2) + (NONCE_PREFIX_BYTES * 2))
  };
}

function encodeSequence(sequence: bigint) {
  const buffer = Buffer.alloc(SEQUENCE_BYTES);
  buffer.writeBigUInt64BE(sequence);
  return buffer;
}

function nonceFor(prefix: Buffer, sequence: bigint) {
  return Buffer.concat([prefix, encodeSequence(sequence)]);
}

export function encryptVoicePacket(
  key: Buffer,
  noncePrefix: Buffer,
  aad: Buffer,
  sequence: bigint,
  plaintext: Uint8Array
) {
  const cipher = createCipheriv("aes-256-gcm", key, nonceFor(noncePrefix, sequence));
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([encodeSequence(sequence), ciphertext, cipher.getAuthTag()]);
}

export function decryptVoicePacket(
  key: Buffer,
  noncePrefix: Buffer,
  aad: Buffer,
  packet: Uint8Array
) {
  const buffer = Buffer.from(packet);
  if (buffer.length < SEQUENCE_BYTES + AUTH_TAG_BYTES) {
    throw new Error("Voice packet is too short");
  }

  const sequence = buffer.readBigUInt64BE(0);
  const ciphertext = buffer.subarray(SEQUENCE_BYTES, buffer.length - AUTH_TAG_BYTES);
  const authTag = buffer.subarray(buffer.length - AUTH_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonceFor(noncePrefix, sequence));
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);

  return {
    sequence,
    plaintext: Buffer.concat([decipher.update(ciphertext), decipher.final()])
  };
}

function sendJson(socket: Socket, payload: object) {
  socket.write(`${JSON.stringify(payload)}\n`);
}

function nextJsonMessage<T>(lineReader: Interface, timeoutMs: number): Promise<T> {
  return withTimeout(
    new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        lineReader.removeListener("line", onLine);
        lineReader.removeListener("close", onClose);
        lineReader.removeListener("error", onError);
      };

      const onLine = (line: string) => {
        cleanup();
        try {
          resolve(JSON.parse(line) as T);
        } catch (error) {
          reject(error);
        }
      };

      const onClose = () => {
        cleanup();
        reject(new Error("Connection closed during handshake"));
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      lineReader.once("line", onLine);
      lineReader.once("close", onClose);
      lineReader.once("error", onError);
    }),
    timeoutMs,
    "Timed out waiting for handshake message"
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function bindUdpSocket(host: string) {
  const socket = createSocket("udp4");
  socket.bind(0, host);
  await once(socket, "listening");
  return socket;
}

function destroySocket(socket: Socket) {
  socket.end();
  socket.destroy();
}

export class SecureVoiceClient {
  private readonly host: string;
  private readonly udpSocket: DgramSocket;
  private readonly remoteUdpPort: number;
  private readonly session: SessionState;
  private readonly timeoutMs: number;

  private constructor(host: string, udpSocket: DgramSocket, remoteUdpPort: number, session: SessionState, timeoutMs: number) {
    this.host = host;
    this.udpSocket = udpSocket;
    this.remoteUdpPort = remoteUdpPort;
    this.session = session;
    this.timeoutMs = timeoutMs;
  }

  static async connect(options: SecureVoiceConnectionOptions) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const udpSocket = await bindUdpSocket(options.host);
    const tcpSocket = new Socket();
    const lineReader = createInterface({ input: tcpSocket });
    let client: SecureVoiceClient | null = null;

    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          tcpSocket.once("connect", () => resolve());
          tcpSocket.once("error", reject);
          tcpSocket.connect(options.tcpPort, options.host);
        }),
        timeoutMs,
        "Timed out connecting to auth server"
      );

      const { privateKey, publicKey } = generateKeyPairSync("x25519");
      const init: AuthInitMessage = {
        type: "auth-init",
        username: options.username,
        clientPublicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
        clientNonce: toBase64Url(randomBytes(16)),
        udpPort: udpSocket.address().port
      };

      sendJson(tcpSocket, init);

      const challenge = await nextJsonMessage<HandshakeResponse>(lineReader, timeoutMs);
      if (challenge.type === "auth-error") {
        throw new Error(challenge.reason);
      }

      const sharedSecret = diffieHellman({
        privateKey,
        publicKey: publicKeyFromDer(challenge.serverPublicKey)
      });
      const transcript = transcriptHash(init, challenge);
      const passwordKey = derivePasswordKey(options.password, asBuffer(challenge.salt));
      const clientProof = deriveProof(passwordKey, CLIENT_PROOF_LABEL, transcript, sharedSecret);
      sendJson(tcpSocket, {
        type: "auth-proof",
        proof: toBase64Url(clientProof)
      } satisfies AuthProofMessage);

      const finalMessage = await nextJsonMessage<FinalHandshakeResponse>(lineReader, timeoutMs);
      if (finalMessage.type === "auth-error") {
        throw new Error(finalMessage.reason);
      }

      const expectedServerProof = deriveProof(passwordKey, SERVER_PROOF_LABEL, transcript, sharedSecret);
      if (!timingSafeEqual(expectedServerProof, asBuffer(finalMessage.serverProof))) {
        throw new Error("Server proof verification failed");
      }

      const secrets = deriveTransportSecrets(sharedSecret, init, challenge);
      const session: SessionState = {
        sessionId: finalMessage.sessionId,
        secrets,
        clientSequence: 0n,
        serverSequence: 0n
      };

      client = new SecureVoiceClient(options.host, udpSocket, challenge.serverUdpPort, session, timeoutMs);
      return client;
    } finally {
      lineReader.close();
      destroySocket(tcpSocket);
      if (!client) {
        await new Promise<void>((resolve) => {
          udpSocket.close(() => resolve());
        });
      }
    }
  }

  get info(): SecureVoiceClientInfo {
    return {
      sessionId: this.session.sessionId,
      remoteUdpPort: this.remoteUdpPort
    };
  }

  async sendVoiceFrame(payload: Uint8Array) {
    const packet = encryptVoicePacket(
      this.session.secrets.clientKey,
      this.session.secrets.clientNoncePrefix,
      this.session.secrets.aad,
      this.session.clientSequence,
      payload
    );
    this.session.clientSequence += 1n;
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        this.udpSocket.send(packet, this.remoteUdpPort, this.host, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
      this.timeoutMs,
      "Timed out sending voice packet"
    );
  }

  async receiveVoiceFrame() {
    const message = await withTimeout(
      new Promise<Buffer>((resolve, reject) => {
        const onMessage = (packet: Buffer) => {
          cleanup();
          resolve(packet);
        };

        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };

        const cleanup = () => {
          this.udpSocket.off("message", onMessage);
          this.udpSocket.off("error", onError);
        };

        this.udpSocket.once("message", onMessage);
        this.udpSocket.once("error", onError);
      }),
      this.timeoutMs,
      "Timed out waiting for encrypted voice packet"
    );

    const { sequence, plaintext } = decryptVoicePacket(
      this.session.secrets.serverKey,
      this.session.secrets.serverNoncePrefix,
      this.session.secrets.aad,
      message
    );

    this.session.serverSequence = sequence + 1n;
    return plaintext;
  }

  async roundTripVoiceFrame(payload: Uint8Array) {
    await this.sendVoiceFrame(payload);
    return this.receiveVoiceFrame();
  }

  async close() {
    await new Promise<void>((resolve) => {
      this.udpSocket.close(() => resolve());
    });
  }
}

function publicKeyFromDer(value: string) {
  return createPublicKey({
    key: Buffer.from(value, "base64url"),
    format: "der",
    type: "spki"
  });
}

export async function createSecureVoiceDemoServer(options: SecureVoiceDemoServerOptions): Promise<SecureVoiceDemoServer> {
  const host = options.host ?? "127.0.0.1";
  const udpSocket = await bindUdpSocket(host);
  const receivedVoiceFrames: Buffer[] = [];
  const encryptedVoiceFrames: Buffer[] = [];
  let activeSession: SessionState | null = null;
  const openSockets = new Set<Socket>();

  udpSocket.on("message", (message, remote) => {
    if (!activeSession) {
      return;
    }

    encryptedVoiceFrames.push(Buffer.from(message));

    try {
      const { sequence, plaintext } = decryptVoicePacket(
        activeSession.secrets.clientKey,
        activeSession.secrets.clientNoncePrefix,
        activeSession.secrets.aad,
        message
      );
      activeSession.clientSequence = sequence + 1n;
      receivedVoiceFrames.push(plaintext);

      const responsePayload = options.echoTransform ? options.echoTransform(plaintext) : Buffer.from(`echo:${plaintext.toString("utf8")}`, "utf8");
      const responsePacket = encryptVoicePacket(
        activeSession.secrets.serverKey,
        activeSession.secrets.serverNoncePrefix,
        activeSession.secrets.aad,
        activeSession.serverSequence,
        responsePayload
      );
      activeSession.serverSequence += 1n;
      udpSocket.send(responsePacket, remote.port, remote.address);
    } catch {
      // Ignore invalid/tampered packets in the demo server.
    }
  });

  const tcpServer = createServer((socket) => {
    openSockets.add(socket);
    socket.once("close", () => {
      openSockets.delete(socket);
    });

    void handleHandshake(socket, options.users, udpSocket.address().port).then(
      (sessionState) => {
        activeSession = sessionState;
      },
      () => {
        // The demo server allows failed auth attempts without crashing the process.
      }
    );
  });

  await new Promise<void>((resolve, reject) => {
    tcpServer.once("error", reject);
    tcpServer.listen(options.tcpPort ?? 0, host, () => resolve());
  });

  return {
    address: {
      host,
      tcpPort: (tcpServer.address() as { port: number }).port,
      udpPort: udpSocket.address().port
    },
    receivedVoiceFrames,
    encryptedVoiceFrames,
    async close() {
      for (const socket of openSockets) {
        socket.destroy();
      }

      if ("closeAllConnections" in tcpServer) {
        (tcpServer as typeof tcpServer & { closeAllConnections?: () => void }).closeAllConnections?.();
      }

      await Promise.all([
        new Promise<void>((resolve) => tcpServer.close(() => resolve())),
        new Promise<void>((resolve) => udpSocket.close(() => resolve()))
      ]);
    }
  };
}

async function handleHandshake(socket: Socket, users: Record<string, string>, serverUdpPort: number) {
  const lineReader = createInterface({ input: socket });

  try {
    const init = await nextJsonMessage<AuthInitMessage>(lineReader, DEFAULT_TIMEOUT_MS);
    const password = users[init.username];
    if (!password) {
      sendJson(socket, { type: "auth-error", reason: "Unknown user" } satisfies AuthErrorMessage);
      throw new Error("Unknown user");
    }

    const salt = randomBytes(16);
    const { privateKey, publicKey } = generateKeyPairSync("x25519");
    const challenge: AuthChallengeMessage = {
      type: "auth-challenge",
      salt: toBase64Url(salt),
      serverPublicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
      serverNonce: toBase64Url(randomBytes(16)),
      serverUdpPort
    };
    sendJson(socket, challenge);

    const proofMessage = await nextJsonMessage<AuthProofMessage>(lineReader, DEFAULT_TIMEOUT_MS);
    const transcript = transcriptHash(init, challenge);
    const sharedSecret = diffieHellman({
      privateKey,
      publicKey: publicKeyFromDer(init.clientPublicKey)
    });
    const passwordKey = derivePasswordKey(password, salt);
    const expectedProof = deriveProof(passwordKey, CLIENT_PROOF_LABEL, transcript, sharedSecret);
    const actualProof = asBuffer(proofMessage.proof);

    if (expectedProof.length !== actualProof.length || !timingSafeEqual(expectedProof, actualProof)) {
      sendJson(socket, { type: "auth-error", reason: "Authentication failed" } satisfies AuthErrorMessage);
      throw new Error("Authentication failed");
    }

    const sessionId = toBase64Url(randomBytes(12));
    const serverProof = deriveProof(passwordKey, SERVER_PROOF_LABEL, transcript, sharedSecret);
    sendJson(socket, {
      type: "auth-ok",
      sessionId,
      serverProof: toBase64Url(serverProof)
    } satisfies AuthOkMessage);

    return {
      sessionId,
      secrets: deriveTransportSecrets(sharedSecret, init, challenge),
      clientSequence: 0n,
      serverSequence: 0n
    } satisfies SessionState;
  } finally {
    lineReader.close();
    destroySocket(socket);
  }
}

export async function runSecureVoiceSelfTest(): Promise<SecureVoiceSelfTestResult> {
  const server = await createSecureVoiceDemoServer({
    users: {
      tester: "voice-ready"
    }
  });

  let client: SecureVoiceClient | null = null;

  try {
    client = await SecureVoiceClient.connect({
      host: server.address.host,
      tcpPort: server.address.tcpPort,
      username: "tester",
      password: "voice-ready"
    });

    const echoedPayload = await client.roundTripVoiceFrame(Buffer.from("authenticated voice", "utf8"));
    return {
      sessionId: client.info.sessionId,
      echoedPayload: echoedPayload.toString("utf8"),
      cipherSuite: "X25519 + scrypt + HKDF + AES-256-GCM"
    };
  } finally {
    await client?.close();
    await server.close();
  }
}
