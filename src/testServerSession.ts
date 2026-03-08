import type {
  AppClientChannelSnapshot,
  AppClientChatMessage,
  AppClientLiveSession,
  AppClientParticipantSnapshot
} from "../electron/appClientState.js";

export type ScheduledLiveSession = {
  delayMs: number;
  session: AppClientLiveSession;
};

const createChannelList = (): AppClientChannelSnapshot[] => [
  { id: "lobby", name: "Lobby", parentId: null },
  { id: "squad", name: "Squad Room", parentId: "lobby" },
  { id: "afk", name: "AFK", parentId: null }
];

const createBaseParticipants = (nickname: string): AppClientParticipantSnapshot[] => [
  { id: "self", name: nickname, channelId: "lobby", status: "live", isSelf: true },
  { id: "atlas", name: "Atlas", channelId: "lobby", status: "live" },
  { id: "echo", name: "Echo", channelId: "squad", status: "idle" }
];

const createBaseMessages = (nickname: string): AppClientChatMessage[] => [
  {
    id: "welcome",
    author: "Server",
    body: `Welcome ${nickname}! Realtime room updates are live.`,
    channelId: null,
    sentAt: "2026-03-07T22:00:00.000Z"
  },
  {
    id: "permissions",
    author: "Server",
    body: "Text chat is enabled for the Lobby and direct replies.",
    channelId: null,
    sentAt: "2026-03-07T22:00:03.000Z"
  },
  {
    id: "lobby-checkin",
    author: "Atlas",
    body: "Lobby comms check.",
    channelId: "lobby",
    sentAt: "2026-03-07T22:00:05.000Z"
  }
];

export const createTestServerSessions = (nickname: string): ScheduledLiveSession[] => {
  const channels = createChannelList();
  const initialParticipants = createBaseParticipants(nickname);
  const initialMessages = createBaseMessages(nickname);

  return [
    {
      delayMs: 0,
      session: {
        channels,
        activeChannelId: "lobby",
        participants: initialParticipants,
        messages: initialMessages,
        telemetry: {
          latencyMs: 41,
          jitterMs: 7.2,
          packetLoss: 0
        }
      }
    },
    {
      delayMs: 1200,
      session: {
        channels,
        activeChannelId: "lobby",
        participants: [
          ...initialParticipants,
          { id: "nova", name: "Nova", channelId: "lobby", status: "live" }
        ],
        messages: [
          ...initialMessages,
          {
            id: "nova-join",
            author: "Nova",
            body: "Joining Lobby now.",
            channelId: "lobby",
            sentAt: "2026-03-07T22:00:12.000Z"
          },
          {
            id: "atlas-dm",
            author: "Atlas",
            body: "Ping me directly before you move to Squad Room.",
            channelId: null,
            participantId: "atlas",
            sentAt: "2026-03-07T22:00:15.000Z"
          }
        ],
        telemetry: {
          latencyMs: 36,
          jitterMs: 5.4,
          packetLoss: 0
        }
      }
    },
    {
      delayMs: 2400,
      session: {
        channels,
        activeChannelId: "lobby",
        participants: [
          { id: "self", name: nickname, channelId: "lobby", status: "live", isSelf: true },
          { id: "atlas", name: "Atlas", channelId: "squad", status: "idle" },
          { id: "echo", name: "Echo", channelId: "squad", status: "live" },
          { id: "nova", name: "Nova", channelId: "lobby", status: "muted" }
        ],
        messages: [
          ...initialMessages,
          {
            id: "nova-join",
            author: "Nova",
            body: "Joining Lobby now.",
            channelId: "lobby",
            sentAt: "2026-03-07T22:00:12.000Z"
          },
          {
            id: "atlas-move",
            author: "Atlas",
            body: "Moving over to Squad Room for strategy chat.",
            channelId: "squad",
            sentAt: "2026-03-07T22:00:20.000Z"
          },
          {
            id: "message-rate-limit",
            author: "Server",
            body: "Server notice: message delivery may be delayed while permissions refresh.",
            channelId: null,
            severity: "error",
            sentAt: "2026-03-07T22:00:24.000Z"
          }
        ],
        telemetry: {
          latencyMs: 33,
          jitterMs: 4.8,
          packetLoss: 0
        }
      }
    }
  ];
};
