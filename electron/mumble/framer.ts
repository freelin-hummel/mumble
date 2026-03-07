import { Buffer } from "node:buffer";
import {
  MAXIMUM_CONTROL_FRAME_SIZE,
  type ProtobufControlMessage,
  isTCPMessageType
} from "./types.js";

const CONTROL_FRAME_HEADER_SIZE = 6;

export class ProtobufFrameDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtobufFrameDecodeError";
  }
}

export class ProtobufFramer {
  #pending = Buffer.alloc(0);

  get pendingByteLength(): number {
    return this.#pending.length;
  }

  reset(): void {
    this.#pending = Buffer.alloc(0);
  }

  encode(message: ProtobufControlMessage): Buffer {
    const payload = Buffer.from(message.payload);

    if (payload.length > MAXIMUM_CONTROL_FRAME_SIZE) {
      throw new RangeError(
        `Control frame payload exceeds ${MAXIMUM_CONTROL_FRAME_SIZE} bytes.`
      );
    }

    const frame = Buffer.allocUnsafe(CONTROL_FRAME_HEADER_SIZE + payload.length);
    frame.writeUInt16BE(message.type, 0);
    frame.writeUInt32BE(payload.length, 2);
    payload.copy(frame, CONTROL_FRAME_HEADER_SIZE);

    return frame;
  }

  push(chunk: Uint8Array): ProtobufControlMessage[] {
    let buffer = this.#pending.length === 0
      ? Buffer.from(chunk)
      : Buffer.concat([this.#pending, Buffer.from(chunk)]);

    const messages: ProtobufControlMessage[] = [];

    while (buffer.length >= CONTROL_FRAME_HEADER_SIZE) {
      const rawType = buffer.readUInt16BE(0);
      const payloadLength = buffer.readUInt32BE(2);

      if (payloadLength > MAXIMUM_CONTROL_FRAME_SIZE) {
        this.reset();
        throw new ProtobufFrameDecodeError(
          `Control frame payload exceeds ${MAXIMUM_CONTROL_FRAME_SIZE} bytes.`
        );
      }

      if (!isTCPMessageType(rawType)) {
        this.reset();
        throw new ProtobufFrameDecodeError(`Unknown TCP message type: ${rawType}`);
      }

      const frameLength = CONTROL_FRAME_HEADER_SIZE + payloadLength;
      if (buffer.length < frameLength) {
        break;
      }

      messages.push({
        type: rawType,
        payload: Buffer.from(buffer.subarray(CONTROL_FRAME_HEADER_SIZE, frameLength))
      });

      buffer = buffer.subarray(frameLength);
    }

    this.#pending = Buffer.from(buffer);

    return messages;
  }
}
