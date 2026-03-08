export type ChatViewTarget = (
  | { type: "channel"; channelId: string | null }
  | { type: "participant"; participantId: string }
);

export type ChatReadState = Record<string, string[] | undefined>;

export const getChatViewTarget = (
  appState: AppClientState,
  selectedParticipantId: string | null
): ChatViewTarget => {
  const selectedParticipant = appState.participants.find((participant) => participant.id === selectedParticipantId);
  if (selectedParticipant && !selectedParticipant.isSelf) {
    return {
      type: "participant",
      participantId: selectedParticipant.id
    };
  }

  return {
    type: "channel",
    channelId: appState.activeChannelId
  };
};

export const getChatTargetKey = (target: ChatViewTarget) => (
  target.type === "participant"
    ? `participant:${target.participantId}`
    : `channel:${target.channelId ?? "server"}`
);

const isServerScopedMessage = (message: AppClientChatMessage) => (
  message.channelId === null && !message.participantId
);

export const messageMatchesChatTarget = (
  message: AppClientChatMessage,
  target: ChatViewTarget
) => {
  if (isServerScopedMessage(message)) {
    return true;
  }

  if (target.type === "participant") {
    return message.participantId === target.participantId;
  }

  return !message.participantId && message.channelId === target.channelId;
};

export const getChatMessagesForTarget = (
  messages: AppClientChatMessage[],
  target: ChatViewTarget
) => messages.filter((message) => messageMatchesChatTarget(message, target));

export const getUnreadCountForTarget = (
  messages: AppClientChatMessage[],
  target: ChatViewTarget,
  readMessageIds: string[] = []
) => {
  const readMessageIdSet = new Set(readMessageIds);
  return messages.filter((message) => {
    if (message.isSelf || readMessageIdSet.has(message.id) || isServerScopedMessage(message)) {
      return false;
    }

    if (target.type === "participant") {
      return message.participantId === target.participantId;
    }

    return !message.participantId && message.channelId === target.channelId;
  }).length;
};
