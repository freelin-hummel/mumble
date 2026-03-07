export {};

declare global {
  interface Window {
    app?: {
      versions: NodeJS.ProcessVersions;
      platform: NodeJS.Platform;
    };
  }
}
