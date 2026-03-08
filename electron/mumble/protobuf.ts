const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

enum ProtobufWireType {
  Varint = 0,
  Fixed64 = 1,
  LengthDelimited = 2,
  Fixed32 = 5
}

const MAX_VARINT_BYTES = 10;

export class ProtobufWireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtobufWireError";
  }
}

const assertSafeInteger = (value: bigint, fieldName: string) => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ProtobufWireError(`${fieldName} exceeds the JavaScript safe integer range.`);
  }

  return Number(value);
};

export class ProtobufReader {
  readonly #buffer: Uint8Array;
  #offset = 0;

  constructor(buffer: Uint8Array) {
    this.#buffer = buffer;
  }

  get eof(): boolean {
    return this.#offset >= this.#buffer.length;
  }

  readTag(): { fieldNumber: number; wireType: number } {
    const rawTag = this.readVarint();
    const fieldNumber = Number(rawTag >> 3n);
    const wireType = Number(rawTag & 0x07n);

    if (fieldNumber < 1) {
      throw new ProtobufWireError("Encountered an invalid protobuf field tag.");
    }

    return {
      fieldNumber,
      wireType
    };
  }

  readVarint(): bigint {
    let shift = 0n;
    let value = 0n;

    for (let index = 0; index < MAX_VARINT_BYTES; index += 1) {
      if (this.#offset >= this.#buffer.length) {
        throw new ProtobufWireError("Unexpected end of protobuf payload while reading a varint.");
      }

      const byte = this.#buffer[this.#offset] ?? 0;
      this.#offset += 1;
      value |= BigInt(byte & 0x7f) << shift;

      if ((byte & 0x80) === 0) {
        return value;
      }

      shift += 7n;
    }

    throw new ProtobufWireError("Encountered an oversized protobuf varint.");
  }

  readUint32(fieldName = "uint32"): number {
    return assertSafeInteger(this.readVarint(), fieldName) >>> 0;
  }

  readUint64(): bigint {
    return this.readVarint();
  }

  readInt32(fieldName = "int32"): number {
    const rawValue = this.readVarint();
    return Number(BigInt.asIntN(32, rawValue));
  }

  readBool(): boolean {
    return this.readVarint() !== 0n;
  }

  readFloat(): number {
    const bytes = this.readFixedBytes(4);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(0, true);
  }

  readBytes(): Uint8Array {
    const length = this.readUint32("bytes length");
    return this.readFixedBytes(length);
  }

  readString(): string {
    return textDecoder.decode(this.readBytes());
  }

  skipField(wireType: number): void {
    switch (wireType) {
      case ProtobufWireType.Varint:
        this.readVarint();
        return;
      case ProtobufWireType.Fixed64:
        this.readFixedBytes(8);
        return;
      case ProtobufWireType.LengthDelimited:
        this.readBytes();
        return;
      case ProtobufWireType.Fixed32:
        this.readFixedBytes(4);
        return;
      default:
        throw new ProtobufWireError(`Unsupported protobuf wire type: ${wireType}`);
    }
  }

  readNestedBytes(expectedWireType: number): Uint8Array {
    if (expectedWireType !== ProtobufWireType.LengthDelimited) {
      throw new ProtobufWireError("Expected a length-delimited protobuf field.");
    }

    return this.readBytes();
  }

  readPackedUint32(target: number[], wireType: number): boolean {
    if (wireType === ProtobufWireType.Varint) {
      target.push(this.readUint32());
      return true;
    }

    if (wireType !== ProtobufWireType.LengthDelimited) {
      return false;
    }

    const nestedReader = new ProtobufReader(this.readBytes());
    while (!nestedReader.eof) {
      target.push(nestedReader.readUint32());
    }
    return true;
  }

  readPackedInt32(target: number[], wireType: number): boolean {
    if (wireType === ProtobufWireType.Varint) {
      target.push(this.readInt32());
      return true;
    }

    if (wireType !== ProtobufWireType.LengthDelimited) {
      return false;
    }

    const nestedReader = new ProtobufReader(this.readBytes());
    while (!nestedReader.eof) {
      target.push(nestedReader.readInt32());
    }
    return true;
  }

  readPackedString(target: string[], wireType: number): boolean {
    if (wireType !== ProtobufWireType.LengthDelimited) {
      return false;
    }

    target.push(this.readString());
    return true;
  }

  readPackedBytes(target: Uint8Array[], wireType: number): boolean {
    if (wireType !== ProtobufWireType.LengthDelimited) {
      return false;
    }

    target.push(this.readBytes());
    return true;
  }

  readFixedBytes(length: number): Uint8Array {
    const endOffset = this.#offset + length;
    if (endOffset > this.#buffer.length) {
      throw new ProtobufWireError("Unexpected end of protobuf payload.");
    }

    const chunk = this.#buffer.subarray(this.#offset, endOffset);
    this.#offset = endOffset;
    return chunk;
  }
}

export class ProtobufWriter {
  readonly #chunks: Uint8Array[] = [];
  #length = 0;

  writeTag(fieldNumber: number, wireType: number): void {
    this.writeVarint((BigInt(fieldNumber) << 3n) | BigInt(wireType));
  }

  writeVarint(value: number | bigint): void {
    let nextValue = typeof value === "bigint"
      ? value
      : value < 0
        ? BigInt.asUintN(64, BigInt(value))
        : BigInt(value);

    if (nextValue < 0) {
      throw new ProtobufWireError("Protobuf varints must not be negative.");
    }

    const bytes: number[] = [];
    do {
      const byte = Number(nextValue & 0x7fn);
      nextValue >>= 7n;
      bytes.push(nextValue === 0n ? byte : byte | 0x80);
    } while (nextValue !== 0n);

    this.pushChunk(Uint8Array.from(bytes));
  }

  writeUint32(fieldNumber: number, value: number | undefined): void {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      return;
    }

    this.writeTag(fieldNumber, ProtobufWireType.Varint);
    this.writeVarint(value);
  }

  writeUint64(fieldNumber: number, value: number | bigint | undefined): void {
    if (value === undefined || value === null) {
      return;
    }

    this.writeTag(fieldNumber, ProtobufWireType.Varint);
    this.writeVarint(value);
  }

  writeInt32(fieldNumber: number, value: number | undefined): void {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return;
    }

    this.writeTag(fieldNumber, ProtobufWireType.Varint);
    this.writeVarint(value);
  }

  writeBool(fieldNumber: number, value: boolean | undefined): void {
    if (typeof value !== "boolean") {
      return;
    }

    this.writeTag(fieldNumber, ProtobufWireType.Varint);
    this.writeVarint(value ? 1 : 0);
  }

  writeFloat(fieldNumber: number, value: number | undefined): void {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return;
    }

    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, true);
    this.writeTag(fieldNumber, ProtobufWireType.Fixed32);
    this.pushChunk(bytes);
  }

  writeBytes(fieldNumber: number, value: Uint8Array | undefined): void {
    if (!(value instanceof Uint8Array)) {
      return;
    }

    this.writeTag(fieldNumber, ProtobufWireType.LengthDelimited);
    this.writeVarint(value.byteLength);
    this.pushChunk(value);
  }

  writeString(fieldNumber: number, value: string | undefined): void {
    if (typeof value !== "string") {
      return;
    }

    const bytes = textEncoder.encode(value);
    this.writeTag(fieldNumber, ProtobufWireType.LengthDelimited);
    this.writeVarint(bytes.byteLength);
    this.pushChunk(bytes);
  }

  writeRepeatedUint32(fieldNumber: number, values: number[] | undefined): void {
    if (!Array.isArray(values)) {
      return;
    }

    for (const value of values) {
      this.writeUint32(fieldNumber, value);
    }
  }

  writeRepeatedInt32(fieldNumber: number, values: number[] | undefined): void {
    if (!Array.isArray(values)) {
      return;
    }

    for (const value of values) {
      this.writeInt32(fieldNumber, value);
    }
  }

  writeRepeatedString(fieldNumber: number, values: string[] | undefined): void {
    if (!Array.isArray(values)) {
      return;
    }

    for (const value of values) {
      this.writeString(fieldNumber, value);
    }
  }

  writeRepeatedBytes(fieldNumber: number, values: Uint8Array[] | undefined): void {
    if (!Array.isArray(values)) {
      return;
    }

    for (const value of values) {
      this.writeBytes(fieldNumber, value);
    }
  }

  writeMessage(fieldNumber: number, value: Uint8Array | undefined): void {
    if (!(value instanceof Uint8Array)) {
      return;
    }

    this.writeTag(fieldNumber, ProtobufWireType.LengthDelimited);
    this.writeVarint(value.byteLength);
    this.pushChunk(value);
  }

  finish(): Uint8Array {
    const output = new Uint8Array(this.#length);
    let offset = 0;

    for (const chunk of this.#chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return output;
  }

  pushChunk(chunk: Uint8Array): void {
    this.#chunks.push(chunk);
    this.#length += chunk.byteLength;
  }
}

export { ProtobufWireType };
