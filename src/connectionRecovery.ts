export type FailedConnectionRecovery = {
  summary: string;
  steps: string[];
};

const ADDRESS_HINT_PATTERN = /\b(address|ports?|ipv6|bracket notation)\b/i;
const NICKNAME_HINT_PATTERN = /\bnickname\b/i;

export const buildFailedConnectionRecovery = (
  errorMessage: string | null,
  details: {
    serverAddress?: string;
    nickname?: string;
  } = {}
): FailedConnectionRecovery => {
  const normalizedError = errorMessage?.trim() ?? "";
  const normalizedServerAddress = details.serverAddress?.trim() || "the last server";
  const normalizedNickname = details.nickname?.trim() || "your current nickname";

  if (NICKNAME_HINT_PATTERN.test(normalizedError)) {
    return {
      summary: "Update the identity details and retry once the form is complete.",
      steps: [
        `Set a nickname before joining ${normalizedServerAddress}.`,
        "Keep the nickname within the server's expected format or policy.",
        "Retry the connection after saving the updated identity."
      ]
    };
  }

  if (ADDRESS_HINT_PATTERN.test(normalizedError)) {
    return {
      summary: `Review ${normalizedServerAddress} before retrying the join request.`,
      steps: [
        "Check the host and port format. IPv6 addresses should use [host]:port notation.",
        "Confirm that the port is between 1 and 65535 and that the server is reachable.",
        `Retry ${normalizedServerAddress} once the address looks correct.`
      ]
    };
  }

  return {
    summary: `Inspect the failure details for ${normalizedServerAddress} and retry when ready.`,
    steps: [
      "Confirm that the server is online and that your network path is stable.",
      `Retry ${normalizedServerAddress} as ${normalizedNickname} after the issue is resolved.`,
      "Open diagnostics if you want to capture logs before trying again."
    ]
  };
};
