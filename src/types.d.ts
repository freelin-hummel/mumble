export {};

declare global {
  type SecureVoiceSelfTestResult = {
    sessionId: string;
    echoedPayload: string;
    cipherSuite: string;
  };

  interface Window {
    app?: {
      versions: NodeJS.ProcessVersions;
      platform: NodeJS.Platform;
      runSecureVoiceSelfTest?: () => Promise<SecureVoiceSelfTestResult>;
    };
  }
}
