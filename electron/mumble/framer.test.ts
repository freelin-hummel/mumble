import assert from "node:assert/strict";
import test from "node:test";
import { ProtobufFrameDecodeError, ProtobufFramer } from "./framer.js";
import { MAXIMUM_CONTROL_FRAME_SIZE, TCPMessageType } from "./types.js";

test("ProtobufFramer encodes control messages with the Mumble TCP header", () => {
  const framer = new ProtobufFramer();
  const payload = Buffer.from([0x08, 0x2a, 0x12, 0x03, 0x66, 0x6f, 0x6f]);

  const frame = framer.encode({
    type: TCPMessageType.Version,
    payload
  });

  assert.equal(frame.readUInt16BE(0), TCPMessageType.Version);
  assert.equal(frame.readUInt32BE(2), payload.length);
  assert.deepEqual(frame.subarray(6), payload);
});

test("ProtobufFramer buffers partial chunks and decodes multiple control messages", () => {
  const framer = new ProtobufFramer();
  const firstFrame = framer.encode({
    type: TCPMessageType.Authenticate,
    payload: Buffer.from([0x0a, 0x04, 0x6a, 0x61, 0x6e, 0x65])
  });
  const secondFrame = framer.encode({
    type: TCPMessageType.Ping,
    payload: Buffer.from([0x08, 0x01])
  });

  assert.deepEqual(framer.push(firstFrame.subarray(0, 4)), []);
  assert.equal(framer.pendingByteLength, 4);

  const messages = framer.push(Buffer.concat([firstFrame.subarray(4), secondFrame]));

  assert.deepEqual(messages, [
    {
      type: TCPMessageType.Authenticate,
      payload: Buffer.from([0x0a, 0x04, 0x6a, 0x61, 0x6e, 0x65])
    },
    {
      type: TCPMessageType.Ping,
      payload: Buffer.from([0x08, 0x01])
    }
  ]);
  assert.equal(framer.pendingByteLength, 0);
});

test("ProtobufFramer rejects oversized control frames", () => {
  const framer = new ProtobufFramer();
  const invalidFrame = Buffer.alloc(6);

  invalidFrame.writeUInt16BE(TCPMessageType.Ping, 0);
  invalidFrame.writeUInt32BE(MAXIMUM_CONTROL_FRAME_SIZE + 1, 2);

  assert.throws(() => framer.push(invalidFrame), ProtobufFrameDecodeError);
  assert.equal(framer.pendingByteLength, 0);
});

test("ProtobufFramer rejects unknown TCP message types", () => {
  const framer = new ProtobufFramer();
  const invalidFrame = Buffer.alloc(6);

  invalidFrame.writeUInt16BE(999, 0);
  invalidFrame.writeUInt32BE(0, 2);

  assert.throws(() => framer.push(invalidFrame), /Unknown TCP message type/);
  assert.equal(framer.pendingByteLength, 0);
});
