import assert from "node:assert/strict";
import test from "node:test";

import { AppClientStore } from "../appClientState.js";
import {
  decodeSessionControlMessage,
  MumbleControlSessionHydrator
} from "./live-session.js";
import { TCPMessageType, type ProtobufControlMessage } from "./types.js";

const WRITE_PERMISSION = 0x1;
const TRAVERSE_PERMISSION = 0x2;
const ENTER_PERMISSION = 0x4;
const SPEAK_PERMISSION = 0x8;
const MUTE_DEAFEN_PERMISSION = 0x10;

type ProtoFieldValue = string | number | boolean;

const encodeVarint = (value: number) => {
  const bytes: number[] = [];
  let remainder = value >>> 0;

  while (remainder >= 0x80) {
    bytes.push((remainder & 0x7f) | 0x80);
    remainder >>>= 7;
  }

  bytes.push(remainder);
  return bytes;
};

const encodeField = (fieldNumber: number, value: ProtoFieldValue) => {
  if (typeof value === "string") {
    const encoded = new TextEncoder().encode(value);
    return [
      ...encodeVarint((fieldNumber << 3) | 2),
      ...encodeVarint(encoded.length),
      ...encoded
    ];
  }

  return [
    ...encodeVarint(fieldNumber << 3),
    ...encodeVarint(typeof value === "boolean" ? Number(value) : value)
  ];
};

const createMessage = (type: TCPMessageType, fields: Array<[number, ProtoFieldValue]>): ProtobufControlMessage => ({
  type,
  payload: Uint8Array.from(fields.flatMap(([fieldNumber, value]) => encodeField(fieldNumber, value)))
});

test("decodeSessionControlMessage parses the live session control payloads needed by the renderer", () => {
  assert.deepEqual(
    decodeSessionControlMessage(createMessage(TCPMessageType.ServerSync, [
      [1, 7],
      [4, ENTER_PERMISSION | SPEAK_PERMISSION | TRAVERSE_PERMISSION]
    ])),
    {
      type: "serverSync",
      sessionId: "7",
      permissions: ENTER_PERMISSION | SPEAK_PERMISSION | TRAVERSE_PERMISSION
    }
  );
  assert.deepEqual(
    decodeSessionControlMessage(createMessage(TCPMessageType.ChannelState, [
      [1, 2],
      [2, 1],
      [3, "Squad"],
      [9, 4],
      [13, true]
    ])),
    {
      type: "channelState",
      channelId: "2",
      parentId: "1",
      name: "Squad",
      position: 4,
      canEnter: true
    }
  );
  assert.deepEqual(
    decodeSessionControlMessage(createMessage(TCPMessageType.UserState, [
      [1, 8],
      [3, "Guest"],
      [5, 2],
      [6, true],
      [10, true]
    ])),
    {
      type: "userState",
      sessionId: "8",
      name: "Guest",
      channelId: "2",
      isMuted: true,
      isSelfDeafened: true
    }
  );
});

test("MumbleControlSessionHydrator hydrates and incrementally updates live room state", async () => {
  const store = new AppClientStore({
    waitForConnection: async () => {}
  });
  const hydrator = new MumbleControlSessionHydrator();

  await store.connect({
    serverAddress: "voice.example.test:64738",
    nickname: "Scout"
  });

  const bootstrapMessages: ProtobufControlMessage[] = [
    createMessage(TCPMessageType.ChannelState, [
      [1, 1],
      [3, "Root"]
    ]),
    createMessage(TCPMessageType.ChannelState, [
      [1, 2],
      [2, 1],
      [3, "Squad"],
      [13, true]
    ]),
    createMessage(TCPMessageType.ChannelState, [
      [1, 3],
      [2, 1],
      [3, "Ops"],
      [13, false]
    ]),
    createMessage(TCPMessageType.ServerSync, [
      [1, 7],
      [4, TRAVERSE_PERMISSION | ENTER_PERMISSION | SPEAK_PERMISSION]
    ]),
    createMessage(TCPMessageType.UserState, [
      [1, 7],
      [3, "Scout"],
      [5, 1]
    ]),
    createMessage(TCPMessageType.UserState, [
      [1, 8],
      [3, "Guest"],
      [5, 2],
      [9, true]
    ]),
    createMessage(TCPMessageType.PermissionQuery, [
      [1, 2],
      [2, TRAVERSE_PERMISSION | ENTER_PERMISSION | SPEAK_PERMISSION | WRITE_PERMISSION | MUTE_DEAFEN_PERMISSION]
    ])
  ];

  for (const message of bootstrapMessages) {
    hydrator.applyMessage(store, message);
  }

  let state = store.getState();
  assert.deepEqual(state.channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    parentId: channel.parentId,
    enter: channel.permissions.enter,
    write: channel.permissions.write,
    participantIds: channel.participantIds
  })), [
    {
      id: "1",
      name: "Root",
      parentId: null,
      enter: true,
      write: false,
      participantIds: ["7"]
    },
    {
      id: "3",
      name: "Ops",
      parentId: "1",
      enter: false,
      write: false,
      participantIds: []
    },
    {
      id: "2",
      name: "Squad",
      parentId: "1",
      enter: true,
      write: true,
      participantIds: ["8"]
    }
  ]);
  assert.deepEqual(state.participants, [
    {
      id: "7",
      name: "Scout",
      channelId: "1",
      status: "idle",
      isSelf: true,
      isMuted: undefined,
      isDeafened: undefined,
      isSelfMuted: undefined,
      isSelfDeafened: undefined,
      isSuppressed: undefined
    },
    {
      id: "8",
      name: "Guest",
      channelId: "2",
      status: "muted",
      isSelf: undefined,
      isMuted: undefined,
      isDeafened: undefined,
      isSelfMuted: true,
      isSelfDeafened: undefined,
      isSuppressed: undefined
    }
  ]);
  assert.equal(state.activeChannelId, "1");

  hydrator.applyMessage(store, createMessage(TCPMessageType.UserState, [
    [1, 8],
    [3, "Atlas"],
    [5, 1],
    [7, true]
  ]));
  hydrator.applyMessage(store, createMessage(TCPMessageType.UserRemove, [[1, 7]]));
  hydrator.applyMessage(store, createMessage(TCPMessageType.ChannelRemove, [[1, 3]]));

  state = store.getState();
  assert.deepEqual(state.channels.map((channel) => channel.id), ["1", "2"]);
  assert.deepEqual(state.participants, [
    {
      id: "8",
      name: "Atlas",
      channelId: "1",
      status: "muted",
      isSelf: undefined,
      isMuted: undefined,
      isDeafened: true,
      isSelfMuted: true,
      isSelfDeafened: undefined,
      isSuppressed: undefined
    }
  ]);
});
