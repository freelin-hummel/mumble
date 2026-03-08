import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  IconButton,
  Separator,
  Switch,
  Text,
  TextField,
  Theme
} from "@radix-ui/themes";
import {
  ChatBubbleIcon,
  DownloadIcon,
  GlobeIcon,
  LightningBoltIcon,
  MixerHorizontalIcon,
  PersonIcon,
  SpeakerLoudIcon,
  SpeakerOffIcon
} from "@radix-ui/react-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appendLocalChatMessageState, mergeLiveSessionState } from "../electron/appClientState.js";
import {
  applyOutputDeviceSelection,
  buildAudioDeviceState,
  createInputDeviceConstraints,
  subscribeToAudioDeviceChanges,
  SYSTEM_DEFAULT_DEVICE_ID,
  type BrowserAudioDevice
} from "./audioDevices";
import { QuickAction } from "./components/QuickAction";
import { SectionHeader } from "./components/SectionHeader";
import { StatusChip } from "./components/StatusChip";
import { buildFailedConnectionRecovery } from "./connectionRecovery";
import {
  createDspPipeline,
  dspFeatures,
  loadDspSettings,
  loadDspPipeline,
  persistDspSettings,
  setDspFeature
} from "./dspPipeline.mjs";
import {
  findNextShortcutTarget,
  getDefaultShortcutBinding,
  getShortcutTargetOption,
  shortcutTargetOptions
} from "./shortcutBindings";
import {
  createInitialVoiceActivationState,
  DEFAULT_PUSH_TO_TALK_SHORTCUT,
  DEFAULT_VAD_START_THRESHOLD,
  formatPushToTalkShortcut,
  matchesPushToTalkShortcut,
  shortcutFromKeyboardEvent,
  stepVoiceActivation
} from "./voiceActivation";
import { createTestServerSessions } from "./testServerSession.js";

const fallbackAppState: AppClientState = {
  connection: {
    status: "disconnected",
    serverAddress: "",
    nickname: "",
    error: null
  },
  channels: [],
  activeChannelId: null,
  participants: [],
  messages: [],
  audio: {
    inputDeviceId: SYSTEM_DEFAULT_DEVICE_ID,
    outputDeviceId: SYSTEM_DEFAULT_DEVICE_ID,
    captureEnabled: true,
    selfMuted: false,
    inputGain: 100,
    outputGain: 100
  },
    preferences: {
      pushToTalk: false,
      pushToTalkShortcut: DEFAULT_PUSH_TO_TALK_SHORTCUT,
      shortcutBindings: [],
      favoriteServers: [],
      localNicknames: {},
      autoReconnect: true,
      notificationsEnabled: true,
      showLatencyDetails: false,
      voiceProcessing: loadDspSettings()
    },
  telemetry: {
    latencyMs: null,
    jitterMs: null,
    packetLoss: null
  },
  recentServers: []
};

const audioPresets = [
  {
    label: "Studio clarity",
    description: "Wideband, low noise gate",
    settings: {
      agc: true,
      noiseSuppression: true,
      echoCancellation: false
    }
  },
  {
    label: "Party mode",
    description: "Boost presence and limiter",
    settings: {
      agc: true,
      noiseSuppression: true,
      echoCancellation: true
    }
  },
  {
    label: "Late night",
    description: "Soft compressor, warm EQ",
    settings: {
      agc: false,
      noiseSuppression: true,
      echoCancellation: true
    }
  }
] as const;

const ANALYSER_SMOOTHING_CONSTANT = 0.85;
const RMS_TO_LEVEL_SCALING_FACTOR = 4.5;
const BASE_CHANNEL_PADDING = 16;
const CHANNEL_INDENT_PER_LEVEL = 16;

const statusCopy: Record<AppClientConnectionState["status"], string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
  error: "Needs attention"
};

const buildRecentServers = (recentServers: string[], serverAddress: string) => {
  const normalizedAddress = serverAddress.trim();
  return [normalizedAddress, ...recentServers.filter((value) => value !== normalizedAddress)].slice(0, 5);
};

const buildFavoriteServers = (
  favoriteServers: AppClientPreferences["favoriteServers"],
  serverAddress: string
) => {
  const normalizedAddress = serverAddress.trim();
  if (normalizedAddress.length === 0) {
    return favoriteServers;
  }

  const existingFavorite = favoriteServers.find((favoriteServer) => favoriteServer.address === normalizedAddress);
  return [
    {
      address: normalizedAddress,
      label: existingFavorite?.label ?? normalizedAddress
    },
    ...favoriteServers.filter((favoriteServer) => favoriteServer.address !== normalizedAddress)
  ].slice(0, 10);
};

const formatChatTimestamp = (value: string) => {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "just now";
  }

  return timestamp.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
};

const getParticipantDisplayName = (
  participant: AppClientParticipant,
  localNicknames: AppClientPreferences["localNicknames"]
) => localNicknames[participant.id] ?? participant.name;

const withParticipantLocalNickname = (
  localNicknames: AppClientPreferences["localNicknames"],
  participantId: string,
  nickname: string
) => {
  const normalizedNickname = nickname.trim();
  if (normalizedNickname.length === 0) {
    return Object.fromEntries(Object.entries(localNicknames).filter(([storedParticipantId]) => (
      storedParticipantId !== participantId
    )));
  }

  return {
    ...localNicknames,
    [participantId]: normalizedNickname
  };
};

const createFallbackConnectedState = (
  currentState: AppClientState,
  serverAddress: string,
  nickname: string
): AppClientState => ({
  ...currentState,
  connection: {
    status: "connected",
    serverAddress,
    nickname,
    error: null
  },
  channels: [],
  activeChannelId: null,
  participants: [],
  messages: [],
  telemetry: {
    latencyMs: null,
    jitterMs: null,
    packetLoss: null
  },
  recentServers: buildRecentServers(currentState.recentServers, serverAddress)
});

const getVoiceActivationLabel = (mode: ReturnType<typeof createInitialVoiceActivationState>["mode"]) => {
  switch (mode) {
    case "muted":
      return "Mic muted";
    case "ptt-live":
      return "PTT live";
    case "ptt-armed":
      return "PTT armed";
    case "vad-live":
      return "VAD live";
    case "vad-armed":
    default:
      return "VAD armed";
  }
};

const isEditableTarget = (target: EventTarget | null) => (
  target instanceof HTMLElement
    && (target.isContentEditable
      || target.tagName === "INPUT"
      || target.tagName === "TEXTAREA"
      || target.tagName === "SELECT")
);

export function App() {
  const [handshakeState, setHandshakeState] = useState<"idle" | "running" | "success" | "error">("idle");
  const [selfTestResult, setSelfTestResult] = useState<SecureVoiceSelfTestResult | null>(null);
  const [selfTestError, setSelfTestError] = useState<string | null>(null);
  const platformLabel = typeof window !== "undefined" && window.app
    ? window.app.platform
    : "web";
  const mediaDevices = typeof navigator !== "undefined"
    ? navigator.mediaDevices
    : undefined;
  const [enumeratedDevices, setEnumeratedDevices] = useState<BrowserAudioDevice[]>([]);
  const [selectedInputId, setSelectedInputId] = useState(SYSTEM_DEFAULT_DEVICE_ID);
  const [selectedOutputId, setSelectedOutputId] = useState(SYSTEM_DEFAULT_DEVICE_ID);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isRefreshingDevices, setIsRefreshingDevices] = useState(false);
  const [outputRoutingReady, setOutputRoutingReady] = useState(false);
  const [appState, setAppState] = useState<AppClientState>(fallbackAppState);
  const [isLoadingAppState, setIsLoadingAppState] = useState(Boolean(window.app?.getState));
  const [serverAddress, setServerAddress] = useState("");
  const [nickname, setNickname] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<string | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [dspPipeline, setDspPipelineState] = useState(() => loadDspPipeline());
  const [voiceActivation, setVoiceActivation] = useState(() => createInitialVoiceActivationState());
  const [meteringError, setMeteringError] = useState<string | null>(null);
  const [pushToTalkPressed, setPushToTalkPressed] = useState(false);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [participantNicknameDraft, setParticipantNicknameDraft] = useState("");
  const outputPreviewRef = useRef<HTMLAudioElement>(null);
  const diagnosticsSectionRef = useRef<HTMLDivElement>(null);
  const fallbackLiveSessionTimersRef = useRef<number[]>([]);
  const pushToTalkPressedRef = useRef(false);
  const [dismissedConnectionErrorKey, setDismissedConnectionErrorKey] = useState<string | null>(null);
  const audioSettingsRef = useRef({
    captureEnabled: fallbackAppState.audio.captureEnabled,
    selfMuted: fallbackAppState.audio.selfMuted,
    inputGain: fallbackAppState.audio.inputGain,
    outputGain: fallbackAppState.audio.outputGain,
    pushToTalk: fallbackAppState.preferences.pushToTalk
  });
  const audioDevices = useMemo(() => buildAudioDeviceState(
    enumeratedDevices,
    {
      inputId: selectedInputId,
      outputId: selectedOutputId
    },
    {
      supported: Boolean(mediaDevices?.enumerateDevices),
      error: mediaDevices?.enumerateDevices
        ? audioError
        : "Audio device APIs are unavailable in this runtime."
    }
  ), [audioError, enumeratedDevices, mediaDevices?.enumerateDevices, selectedInputId, selectedOutputId]);

  const syncFormState = useCallback((state: AppClientState) => {
    setServerAddress((currentValue) => (
      currentValue
      || state.connection.serverAddress
      || state.recentServers[0]
      || state.preferences.favoriteServers[0]?.address
      || ""
    ));
    setNickname((currentValue) => currentValue || state.connection.nickname);
  }, []);

  const updateLocalAppState = useCallback((updater: (state: AppClientState) => AppClientState) => {
    setAppState((currentState) => updater(currentState));
  }, []);

  const clearFallbackLiveSessionTimers = useCallback(() => {
    fallbackLiveSessionTimersRef.current.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    fallbackLiveSessionTimersRef.current = [];
  }, []);

  const startFallbackLiveSession = useCallback((nextNickname: string) => {
    clearFallbackLiveSessionTimers();
    fallbackLiveSessionTimersRef.current = createTestServerSessions(nextNickname).map(({ delayMs, session }) => (
      window.setTimeout(() => {
        updateLocalAppState((currentState) => mergeLiveSessionState(currentState, session));
      }, delayMs)
    ));
  }, [clearFallbackLiveSessionTimers, updateLocalAppState]);

  const updateAudioSettings = useCallback(async (audio: Partial<AppClientAudioSettings>) => {
    if (window.app?.updateAudioSettings) {
      const nextState = await window.app.updateAudioSettings(audio);
      setAppState(nextState);
      return;
    }

    updateLocalAppState((currentState) => ({
      ...currentState,
      audio: {
        ...currentState.audio,
        ...audio
      }
    }));
  }, [updateLocalAppState]);

  const updatePreferences = useCallback(async (preferences: Partial<AppClientPreferences>) => {
    if (window.app?.updatePreferences) {
      const nextState = await window.app.updatePreferences(preferences);
      setAppState(nextState);
      return;
    }

    updateLocalAppState((currentState) => ({
      ...currentState,
      preferences: {
        ...currentState.preferences,
        ...preferences
      }
    }));
  }, [updateLocalAppState]);

  const updateFavoriteServers = useCallback((favoriteServers: AppClientPreferences["favoriteServers"]) => {
    void updatePreferences({ favoriteServers });
  }, [updatePreferences]);

  const rememberServer = useCallback(async (nextServerAddress: string) => {
    const normalizedServerAddress = nextServerAddress.trim();
    if (normalizedServerAddress.length === 0) {
      return;
    }

    if (window.app?.rememberServer) {
      const nextState = await window.app.rememberServer(normalizedServerAddress);
      setAppState(nextState);
      setServerAddress(nextState.connection.serverAddress);
      return;
    }

    updateLocalAppState((currentState) => ({
      ...currentState,
      connection: {
        ...currentState.connection,
        serverAddress: normalizedServerAddress
      },
      recentServers: buildRecentServers(currentState.recentServers, normalizedServerAddress)
    }));
    setServerAddress(normalizedServerAddress);
  }, [updateLocalAppState]);

  const loadRecentServer = useCallback((recentServer: string) => {
    setServerAddress(recentServer);
    setFormError(null);
  }, []);

  const loadFavoriteServer = useCallback((favoriteServer: AppClientPreferences["favoriteServers"][number]) => {
    setServerAddress(favoriteServer.address);
    setFormError(null);
  }, []);

  const saveFavoriteServer = useCallback(() => {
    updateFavoriteServers(buildFavoriteServers(appState.preferences.favoriteServers, serverAddress));
  }, [appState.preferences.favoriteServers, serverAddress, updateFavoriteServers]);

  const removeFavoriteServer = useCallback((favoriteAddress: string) => {
    updateFavoriteServers(appState.preferences.favoriteServers.filter((favoriteServer) => (
      favoriteServer.address !== favoriteAddress
    )));
  }, [appState.preferences.favoriteServers, updateFavoriteServers]);

  useEffect(() => {
    audioSettingsRef.current = {
      captureEnabled: appState.audio.captureEnabled,
      selfMuted: appState.audio.selfMuted,
      inputGain: appState.audio.inputGain,
      outputGain: appState.audio.outputGain,
      pushToTalk: appState.preferences.pushToTalk
    };
  }, [
    appState.audio.captureEnabled,
    appState.audio.inputGain,
    appState.audio.outputGain,
    appState.audio.selfMuted,
    appState.preferences.pushToTalk
  ]);

  useEffect(() => {
    pushToTalkPressedRef.current = pushToTalkPressed;
  }, [pushToTalkPressed]);

  useEffect(() => {
    setDspPipelineState(createDspPipeline(appState.preferences.voiceProcessing));
  }, [appState.preferences.voiceProcessing]);

  const refreshAudioDevices = useCallback(async () => {
    if (!mediaDevices?.enumerateDevices) {
      return;
    }

    setIsRefreshingDevices(true);

    try {
      const devices = await mediaDevices.enumerateDevices();
      setEnumeratedDevices(devices);
      setAudioError(null);
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : "Unable to refresh audio devices.");
    } finally {
      setIsRefreshingDevices(false);
    }
  }, [mediaDevices]);

  useEffect(() => {
    void refreshAudioDevices();

    if (!mediaDevices?.enumerateDevices) {
      return undefined;
    }

    return subscribeToAudioDeviceChanges(mediaDevices, refreshAudioDevices);
  }, [mediaDevices, refreshAudioDevices]);

  useEffect(() => {
    if (appState.audio.inputDeviceId !== selectedInputId) {
      setSelectedInputId(appState.audio.inputDeviceId);
    }

    if (appState.audio.outputDeviceId !== selectedOutputId) {
      setSelectedOutputId(appState.audio.outputDeviceId);
    }
  }, [appState.audio.inputDeviceId, appState.audio.outputDeviceId, selectedInputId, selectedOutputId]);

  useEffect(() => {
    if (audioDevices.selectedInputId !== selectedInputId) {
      setSelectedInputId(audioDevices.selectedInputId);
    }

    if (audioDevices.selectedOutputId !== selectedOutputId) {
      setSelectedOutputId(audioDevices.selectedOutputId);
    }
  }, [audioDevices.selectedInputId, audioDevices.selectedOutputId, selectedInputId, selectedOutputId]);

  useEffect(() => {
    let active = true;

    const syncOutputRoute = async () => {
      try {
        const applied = await applyOutputDeviceSelection(outputPreviewRef.current, audioDevices.selectedOutputId);
        if (active) {
          setOutputRoutingReady(applied);
        }
      } catch {
        if (active) {
          setOutputRoutingReady(false);
        }
      }
    };

    void syncOutputRoute();

    return () => {
      active = false;
    };
  }, [audioDevices.selectedOutputId]);

  useEffect(() => {
    if (!appState.preferences.pushToTalk) {
      setPushToTalkPressed(false);
      return undefined;
    }

    const shortcut = appState.preferences.pushToTalkShortcut || DEFAULT_PUSH_TO_TALK_SHORTCUT;
    const releaseShortcut = () => {
      setPushToTalkPressed(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (!matchesPushToTalkShortcut(shortcut, event)) {
        return;
      }

      event.preventDefault();
      setPushToTalkPressed(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!matchesPushToTalkShortcut(shortcut, event)) {
        return;
      }

      event.preventDefault();
      setPushToTalkPressed(false);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        releaseShortcut();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", releaseShortcut);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", releaseShortcut);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [appState.preferences.pushToTalk, appState.preferences.pushToTalkShortcut]);

  useEffect(() => {
    setVoiceActivation((currentState) => stepVoiceActivation(currentState, {
      inputLevel: currentState.inputLevel,
      captureEnabled: appState.audio.captureEnabled,
      selfMuted: appState.audio.selfMuted,
      pushToTalk: appState.preferences.pushToTalk,
      pushToTalkPressed,
      inputGain: appState.audio.inputGain,
      outputGain: appState.audio.outputGain
    }));
  }, [
    appState.audio.captureEnabled,
    appState.audio.inputGain,
    appState.audio.outputGain,
    appState.audio.selfMuted,
    appState.preferences.pushToTalk,
    pushToTalkPressed
  ]);

  useEffect(() => {
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
      setMeteringError("Microphone metering requires MediaDevices.getUserMedia.");
      setVoiceActivation((currentState) => stepVoiceActivation(currentState, {
        inputLevel: 0,
        captureEnabled: appState.audio.captureEnabled,
        selfMuted: appState.audio.selfMuted,
        pushToTalk: appState.preferences.pushToTalk,
        pushToTalkPressed: pushToTalkPressedRef.current,
        inputGain: appState.audio.inputGain,
        outputGain: appState.audio.outputGain
      }));
      return undefined;
    }

    if (!appState.audio.captureEnabled) {
      setMeteringError(null);
      setVoiceActivation((currentState) => stepVoiceActivation(currentState, {
        inputLevel: 0,
        captureEnabled: false,
        selfMuted: appState.audio.selfMuted,
        pushToTalk: appState.preferences.pushToTalk,
        pushToTalkPressed: pushToTalkPressedRef.current,
        inputGain: appState.audio.inputGain,
        outputGain: appState.audio.outputGain
      }));
      return undefined;
    }

    const windowWithAudioContext = window as Window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextCtor = windowWithAudioContext.AudioContext ?? windowWithAudioContext.webkitAudioContext;
    if (!AudioContextCtor) {
      setMeteringError("AudioContext is unavailable in this runtime.");
      return undefined;
    }

    let cancelled = false;
    let animationFrameId = 0;
    let mediaStream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;

    const stopMetering = () => {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
      mediaStream?.getTracks().forEach((track) => {
        track.stop();
      });
      if (audioContext) {
        void audioContext.close();
      }
    };

    const startMetering = async () => {
      try {
        mediaStream = await mediaDevices.getUserMedia({
          audio: createInputDeviceConstraints(audioDevices.selectedInputId),
          video: false
        });
        if (cancelled) {
          stopMetering();
          return;
        }

        audioContext = new AudioContextCtor();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = ANALYSER_SMOOTHING_CONSTANT;
        audioContext.createMediaStreamSource(mediaStream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);

        setMeteringError(null);

        const tick = () => {
          if (cancelled) {
            return;
          }

          analyser.getFloatTimeDomainData(samples);
          let squaredSum = 0;
          for (const sample of samples) {
            squaredSum += sample * sample;
          }

          const rms = Math.sqrt(squaredSum / samples.length);
          const normalizedLevel = Math.min(1, rms * RMS_TO_LEVEL_SCALING_FACTOR);

          setVoiceActivation((currentState) => stepVoiceActivation(currentState, {
            inputLevel: normalizedLevel,
            captureEnabled: audioSettingsRef.current.captureEnabled,
            selfMuted: audioSettingsRef.current.selfMuted,
            pushToTalk: audioSettingsRef.current.pushToTalk,
            pushToTalkPressed: pushToTalkPressedRef.current,
            inputGain: audioSettingsRef.current.inputGain,
            outputGain: audioSettingsRef.current.outputGain
          }));
          animationFrameId = window.requestAnimationFrame(tick);
        };

        tick();
      } catch (error) {
        if (cancelled) {
          return;
        }

        setMeteringError(error instanceof Error ? error.message : "Microphone metering is unavailable.");
        setVoiceActivation((currentState) => stepVoiceActivation(currentState, {
          inputLevel: 0,
          captureEnabled: appState.audio.captureEnabled,
          selfMuted: appState.audio.selfMuted,
          pushToTalk: appState.preferences.pushToTalk,
          pushToTalkPressed: pushToTalkPressedRef.current,
          inputGain: appState.audio.inputGain,
          outputGain: appState.audio.outputGain
        }));
      }
    };

    void startMetering();

    return () => {
      cancelled = true;
      stopMetering();
    };
  }, [
    appState.audio.captureEnabled,
    appState.audio.inputGain,
    appState.audio.outputGain,
    appState.audio.selfMuted,
    appState.preferences.pushToTalk,
    audioDevices.selectedInputId,
    mediaDevices
  ]);

  useEffect(() => {
    let active = true;

    const loadState = async () => {
      if (!window.app?.getState) {
        setIsLoadingAppState(false);
        return;
      }

      try {
        const nextState = await window.app.getState();
        if (!active) {
          return;
        }

        setAppState(nextState);
        syncFormState(nextState);
      } catch (error) {
        if (active) {
          setFormError(error instanceof Error ? error.message : "Unable to load desktop state.");
        }
      } finally {
        if (active) {
          setIsLoadingAppState(false);
        }
      }
    };

    void loadState();
    const unsubscribe = window.app?.onStateChanged?.((nextState) => {
      if (!active) {
        return;
      }

      setAppState(nextState);
      syncFormState(nextState);
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [syncFormState]);

  useEffect(() => () => {
    clearFallbackLiveSessionTimers();
  }, [clearFallbackLiveSessionTimers]);

  const secureTransportLabel = useMemo(() => {
    if (handshakeState === "running") {
      return "handshake running";
    }

    if (handshakeState === "success") {
      return "encrypted UDP ready";
    }

    if (handshakeState === "error") {
      return "self-test failed";
    }

    return "awaiting self-test";
  }, [handshakeState]);

  const runSelfTest = async () => {
    if (!window.app?.runSecureVoiceSelfTest || handshakeState === "running") {
      return;
    }

    setHandshakeState("running");
    setSelfTestResult(null);
    setSelfTestError(null);

    try {
      const result = await window.app.runSecureVoiceSelfTest();
      setSelfTestResult(result);
      setHandshakeState("success");
    } catch (error) {
      setSelfTestError(error instanceof Error ? error.message : "Unknown handshake failure");
      setHandshakeState("error");
    }
  };

  const activeChannel = useMemo(
    () => appState.channels.find((channel) => channel.id === appState.activeChannelId) ?? null,
    [appState.activeChannelId, appState.channels]
  );
  const activeParticipants = useMemo(
    () => appState.participants.filter((participant) => participant.channelId === appState.activeChannelId),
    [appState.activeChannelId, appState.participants]
  );
  const activeMessages = useMemo(
    () => appState.messages.filter((message) => (
      message.channelId === null || message.channelId === appState.activeChannelId
    )),
    [appState.activeChannelId, appState.messages]
  );
  const selectedParticipant = useMemo(
    () => appState.participants.find((participant) => participant.id === selectedParticipantId) ?? null,
    [appState.participants, selectedParticipantId]
  );
  const selectedParticipantChannel = useMemo(
    () => selectedParticipant
      ? appState.channels.find((channel) => channel.id === selectedParticipant.channelId) ?? null
      : null,
    [appState.channels, selectedParticipant]
  );
  const connectionError = formError ?? appState.connection.error;
  const connectionServerAddress = serverAddress.trim() || appState.connection.serverAddress;
  const connectionNickname = nickname.trim() || appState.connection.nickname;
  const connectionErrorKey = [connectionError, connectionServerAddress, connectionNickname].join("::");
  const isElectronBridgeAvailable = Boolean(window.app?.getState);
  const voiceActivationLabel = useMemo(
    () => getVoiceActivationLabel(voiceActivation.mode),
    [voiceActivation.mode]
  );
  const pushToTalkShortcutLabel = useMemo(
    () => formatPushToTalkShortcut(appState.preferences.pushToTalkShortcut),
    [appState.preferences.pushToTalkShortcut]
  );
  const localNicknames = appState.preferences.localNicknames;
  const shortcutBindings = appState.preferences.shortcutBindings;
  const favoriteServers = appState.preferences.favoriteServers;
  const connectionRecovery = useMemo(() => {
    if (!connectionError) {
      return null;
    }

    return buildFailedConnectionRecovery(connectionError, {
      serverAddress: connectionServerAddress,
      nickname: connectionNickname
    });
  }, [connectionError, connectionNickname, connectionServerAddress]);

  useEffect(() => {
    setDismissedConnectionErrorKey(null);
  }, [connectionErrorKey]);

  useEffect(() => {
    if (!selectedParticipantId) {
      return;
    }

    if (!selectedParticipant) {
      setSelectedParticipantId(null);
    }
  }, [selectedParticipant, selectedParticipantId]);

  useEffect(() => {
    if (!selectedParticipant) {
      setParticipantNicknameDraft("");
      return;
    }

    setParticipantNicknameDraft(localNicknames[selectedParticipant.id] ?? "");
  }, [localNicknames, selectedParticipant]);

  const connectToServer = async () => {
    const normalizedServerAddress = serverAddress.trim();
    const normalizedNickname = nickname.trim();

    if (!normalizedServerAddress) {
      setFormError("Enter a server address to join voice.");
      return;
    }

    if (!normalizedNickname) {
      setFormError("Enter a nickname before joining.");
      return;
    }

    setFormError(null);

    if (window.app?.connect) {
      try {
        const nextState = await window.app.connect({
          serverAddress: normalizedServerAddress,
          nickname: normalizedNickname
        });
        setAppState(nextState);
        setChatDraft("");
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Unable to join voice.");
      }
      return;
    }

    updateLocalAppState((currentState) => ({
      ...currentState,
      connection: {
        status: "connecting",
        serverAddress: normalizedServerAddress,
        nickname: normalizedNickname,
        error: null
      },
      recentServers: buildRecentServers(currentState.recentServers, normalizedServerAddress)
    }));

    window.setTimeout(() => {
      updateLocalAppState((currentState) => createFallbackConnectedState(
        currentState,
        normalizedServerAddress,
        normalizedNickname
      ));
      startFallbackLiveSession(normalizedNickname);
      setChatDraft("");
    }, 250);
  };

  const disconnectFromServer = async () => {
    setFormError(null);
    clearFallbackLiveSessionTimers();
    setChatDraft("");

    if (window.app?.disconnect) {
      const nextState = await window.app.disconnect();
      setAppState(nextState);
      return;
    }

    updateLocalAppState((currentState) => ({
      ...currentState,
      connection: {
        ...currentState.connection,
        status: "disconnected",
        error: null
      },
      channels: [],
      activeChannelId: null,
      participants: [],
      messages: [],
      telemetry: {
        latencyMs: null,
        jitterMs: null,
        packetLoss: null
      }
    }));
  };

  const selectChannel = async (channelId: string) => {
    if (window.app?.selectChannel) {
      const nextState = await window.app.selectChannel(channelId);
      setAppState(nextState);
      return;
    }

    updateLocalAppState((currentState) => ({
      ...currentState,
      activeChannelId: channelId
    }));
  };

  const cycleChannel = async () => {
    if (appState.channels.length === 0) {
      return;
    }

    const currentIndex = appState.channels.findIndex((channel) => channel.id === appState.activeChannelId);
    const nextChannel = appState.channels[(currentIndex + 1) % appState.channels.length];
    if (nextChannel) {
      await selectChannel(nextChannel.id);
    }
  };

  const updateShortcutBindings = useCallback((nextShortcutBindings: AppClientShortcutBinding[]) => {
    void updatePreferences({ shortcutBindings: nextShortcutBindings });
  }, [updatePreferences]);

  const addShortcutBinding = useCallback(() => {
    const nextTarget = findNextShortcutTarget(shortcutBindings);
    if (!nextTarget) {
      return;
    }

    updateShortcutBindings([
      ...shortcutBindings,
      getDefaultShortcutBinding(nextTarget)
    ]);
  }, [shortcutBindings, updateShortcutBindings]);

  const removeShortcutBinding = useCallback((bindingTarget: AppClientShortcutBinding["target"]) => {
    updateShortcutBindings(shortcutBindings.filter((binding) => binding.target !== bindingTarget));
  }, [shortcutBindings, updateShortcutBindings]);

  const updateShortcutBindingTarget = useCallback((
    bindingTarget: AppClientShortcutBinding["target"],
    nextTarget: AppClientShortcutBinding["target"]
  ) => {
    updateShortcutBindings(shortcutBindings.map((binding) => (
      binding.target === bindingTarget
        ? { ...binding, target: nextTarget }
        : binding
    )));
  }, [shortcutBindings, updateShortcutBindings]);

  const updateShortcutBindingShortcut = useCallback((
    bindingTarget: AppClientShortcutBinding["target"],
    nextShortcut: string
  ) => {
    updateShortcutBindings(shortcutBindings.map((binding) => (
      binding.target === bindingTarget
        ? { ...binding, shortcut: nextShortcut }
        : binding
    )));
  }, [shortcutBindings, updateShortcutBindings]);

  const handleShortcutAction = useCallback(async (target: AppClientShortcutBinding["target"]) => {
    switch (target) {
      case "toggleMute":
        await updateAudioSettings({ selfMuted: !appState.audio.selfMuted });
        break;
      case "selectSystemOutput":
        await updateAudioSettings({ outputDeviceId: SYSTEM_DEFAULT_DEVICE_ID });
        break;
      case "toggleLatencyDetails":
        await updatePreferences({ showLatencyDetails: !appState.preferences.showLatencyDetails });
        break;
      case "cycleChannel":
        await cycleChannel();
        break;
    }
  }, [
    appState.audio.selfMuted,
    appState.preferences.showLatencyDetails,
    cycleChannel,
    updateAudioSettings,
    updatePreferences
  ]);

  const exportDiagnostics = async () => {
    if (!window.app?.exportDiagnostics || isExportingDiagnostics) {
      return;
    }

    setDiagnosticsError(null);
    setDiagnosticsMessage(null);
    setIsExportingDiagnostics(true);

    try {
      const result = await window.app.exportDiagnostics({
        audioRuntime: {
          inputLevel: Number(voiceActivation.inputLevel.toFixed(4)),
          outputLevel: Number(voiceActivation.outputLevel.toFixed(4)),
          mode: voiceActivation.mode,
          isTransmitting: voiceActivation.isTransmitting,
          meteringError,
          availableInputDevices: audioDevices.input.length,
          availableOutputDevices: audioDevices.output.length,
          outputRoutingReady
        }
      });

      if (result.canceled) {
        setDiagnosticsMessage("Diagnostics export canceled.");
        return;
      }

      setDiagnosticsMessage(`Diagnostics saved to ${result.filePath}.`);
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : "Unable to export diagnostics.");
    } finally {
      setIsExportingDiagnostics(false);
    }
  };

  useEffect(() => {
    if (shortcutBindings.length === 0) {
      return undefined;
    }

    const reservedShortcut = appState.preferences.pushToTalk
      ? appState.preferences.pushToTalkShortcut
      : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isEditableTarget(event.target)) {
        return;
      }

      const matchedBinding = shortcutBindings.find((binding) => (
        (reservedShortcut === null || binding.shortcut !== reservedShortcut)
        && matchesPushToTalkShortcut(binding.shortcut, event)
      ));

      if (!matchedBinding) {
        return;
      }

      event.preventDefault();
      void handleShortcutAction(matchedBinding.target);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    appState.preferences.pushToTalk,
    appState.preferences.pushToTalkShortcut,
    handleShortcutAction,
    shortcutBindings
  ]);

  const openDiagnostics = () => {
    if (!appState.preferences.showLatencyDetails) {
      void updatePreferences({ showLatencyDetails: true });
    }

    diagnosticsSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const sendChatMessage = async () => {
    if (!chatDraft.trim()) {
      setFormError("Enter a message before sending.");
      return;
    }

    setFormError(null);

    if (window.app?.sendChatMessage) {
      try {
        const nextState = await window.app.sendChatMessage(chatDraft);
        setAppState(nextState);
        setChatDraft("");
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Unable to send chat.");
      }
      return;
    }

    try {
      updateLocalAppState((currentState) => appendLocalChatMessageState(currentState, chatDraft));
      setChatDraft("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to send chat.");
    }
  };

  const saveLocalNickname = useCallback(async () => {
    if (!selectedParticipant) {
      return;
    }

    await updatePreferences({
      localNicknames: withParticipantLocalNickname(
        localNicknames,
        selectedParticipant.id,
        participantNicknameDraft
      )
    });
  }, [localNicknames, participantNicknameDraft, selectedParticipant, updatePreferences]);

  const applyPreset = (settings: typeof audioPresets[number]["settings"]) => {
    const normalizedSettings = persistDspSettings(settings);
    setDspPipelineState(createDspPipeline(normalizedSettings));
    void updatePreferences({ voiceProcessing: normalizedSettings });
  };
  const trimmedServerAddress = serverAddress.trim();

  return (
    <Theme accentColor="cyan" grayColor="slate" radius="large" scaling="105%">
      <Box className="subtle-grid" style={{ minHeight: "100vh" }}>
        <main>
          <audio ref={outputPreviewRef} preload="none" />
          <Flex direction="column" gap="6">
            <Card className="hero-card fade-in">
              <Flex direction={{ initial: "column", md: "row" }} gap="5" align="start">
                <Box style={{ flex: 1 }}>
                  <Flex direction="column" gap="3">
                    <Badge size="2" variant="solid" className="pulse">
                      desktop session shell
                    </Badge>
                    <Heading size="8">Mumble desktop client</Heading>
                    <Text size="3" color="gray">
                      Connect to a server, switch channels, and manage audio without leaving the renderer.
                    </Text>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void connectToServer();
                      }}
                    >
                      <Flex gap="3" wrap="wrap" align="center">
                        <TextField.Root
                          size="3"
                          placeholder="Server address"
                          style={{ minWidth: 240 }}
                          value={serverAddress}
                          onChange={(event) => {
                            setServerAddress(event.target.value);
                          }}
                          disabled={appState.connection.status === "connecting"}
                          list="recent-servers"
                        >
                          <TextField.Slot>
                            <GlobeIcon />
                          </TextField.Slot>
                        </TextField.Root>
                        <datalist id="recent-servers">
                          {appState.recentServers.map((recentServer) => (
                            <option key={recentServer} value={recentServer} />
                          ))}
                        </datalist>
                        <TextField.Root
                          size="3"
                          placeholder="Nickname"
                          style={{ minWidth: 200 }}
                          value={nickname}
                          onChange={(event) => {
                            setNickname(event.target.value);
                          }}
                          disabled={appState.connection.status === "connecting"}
                        >
                          <TextField.Slot>
                            <ChatBubbleIcon />
                          </TextField.Slot>
                        </TextField.Root>
                        <Button size="3" type="submit" disabled={appState.connection.status === "connecting"}>
                          {appState.connection.status === "connecting" ? "Joining…" : "Join voice"}
                        </Button>
                        <Button
                          size="3"
                          variant="outline"
                          type="button"
                          onClick={() => {
                            void rememberServer(serverAddress);
                          }}
                          disabled={appState.connection.status === "connecting" || trimmedServerAddress.length === 0}
                        >
                          Save server
                        </Button>
                        <Button
                          size="3"
                          variant="outline"
                          type="button"
                          onClick={saveFavoriteServer}
                          disabled={appState.connection.status === "connecting" || trimmedServerAddress.length === 0}
                        >
                          Add favorite
                        </Button>
                        <Button
                          size="3"
                          variant="soft"
                          type="button"
                          onClick={() => {
                            void disconnectFromServer();
                          }}
                          disabled={appState.connection.status === "disconnected" && !appState.connection.error}
                        >
                          Disconnect
                        </Button>
                      </Flex>
                      {favoriteServers.length > 0 ? (
                        <Flex direction="column" gap="2" style={{ marginTop: 12 }}>
                          <Text size="2" color="gray">
                            Favorite servers
                          </Text>
                          <Flex gap="2" align="center" wrap="wrap">
                            {favoriteServers.map((favoriteServer) => (
                              <Flex key={favoriteServer.address} gap="1" align="center">
                                <Button
                                  size="1"
                                  variant={trimmedServerAddress === favoriteServer.address ? "solid" : "soft"}
                                  type="button"
                                  onClick={() => {
                                    loadFavoriteServer(favoriteServer);
                                  }}
                                  disabled={appState.connection.status === "connecting"}
                                >
                                  {favoriteServer.label}
                                </Button>
                                <IconButton
                                  size="1"
                                  variant="ghost"
                                  color="ruby"
                                  type="button"
                                  aria-label={`Remove favorite ${favoriteServer.label}`}
                                  onClick={() => {
                                    removeFavoriteServer(favoriteServer.address);
                                  }}
                                  disabled={appState.connection.status === "connecting"}
                                >
                                  ×
                                </IconButton>
                              </Flex>
                            ))}
                          </Flex>
                        </Flex>
                      ) : null}
                      {appState.recentServers.length > 0 ? (
                        <Flex gap="2" align="center" wrap="wrap" style={{ marginTop: 12 }}>
                          <Text size="2" color="gray">
                            Recent servers
                          </Text>
                          {appState.recentServers.map((recentServer) => (
                            <Button
                              key={recentServer}
                              size="1"
                              variant={trimmedServerAddress === recentServer ? "solid" : "soft"}
                              type="button"
                              onClick={() => {
                                loadRecentServer(recentServer);
                              }}
                              disabled={appState.connection.status === "connecting"}
                            >
                              {recentServer}
                            </Button>
                          ))}
                        </Flex>
                      ) : null}
                    </form>
                    <Flex gap="3" align="center" wrap="wrap">
                      <StatusChip
                        status={appState.connection.status === "connected" ? "live" : appState.connection.status === "error" ? "muted" : "idle"}
                        label={statusCopy[appState.connection.status]}
                      />
                      <StatusChip status="idle" label={`Running on ${platformLabel}`} />
                      <StatusChip
                        status={handshakeState === "success" ? "live" : handshakeState === "error" ? "muted" : "idle"}
                        label={secureTransportLabel}
                      />
                      <StatusChip
                        status={voiceActivation.isTransmitting ? "live" : voiceActivation.mode === "muted" ? "muted" : "idle"}
                        label={voiceActivationLabel}
                      />
                      {appState.telemetry.jitterMs !== null ? (
                        <StatusChip status="live" label={`${appState.telemetry.jitterMs} ms jitter`} />
                      ) : null}
                    </Flex>
                    {connectionError && connectionRecovery && dismissedConnectionErrorKey !== connectionErrorKey ? (
                      <Card className="section-card">
                        <Flex direction="column" gap="3">
                          <SectionHeader
                            title="Connection recovery"
                            subtitle={connectionRecovery.summary}
                          />
                          <Text size="2" color="ruby">{connectionError}</Text>
                          <Flex direction="column" gap="2">
                            {connectionRecovery.steps.map((step) => (
                              <Text key={step} size="2" color="gray">• {step}</Text>
                            ))}
                          </Flex>
                          <Flex gap="3" wrap="wrap">
                            <Button
                              size="2"
                              onClick={() => {
                                void connectToServer();
                              }}
                              disabled={appState.connection.status === "connecting"}
                            >
                              Retry connection
                            </Button>
                            <Button
                              size="2"
                              variant="soft"
                              onClick={openDiagnostics}
                            >
                              Open diagnostics
                            </Button>
                            <Button
                              size="2"
                              variant="ghost"
                              onClick={() => {
                                setFormError(null);
                                setDismissedConnectionErrorKey(connectionErrorKey);
                              }}
                            >
                              Dismiss
                            </Button>
                          </Flex>
                        </Flex>
                      </Card>
                    ) : null}
                    {isLoadingAppState ? (
                      <Text size="2" color="gray">Loading saved desktop state…</Text>
                    ) : null}
                    {!isElectronBridgeAvailable ? (
                      <Text size="2" color="gray">
                        Open the Electron shell to persist session state, recent servers, and preferences.
                      </Text>
                    ) : null}
                  </Flex>
                </Box>
                <Card className="section-card" style={{ minWidth: 300 }}>
                  <Flex direction="column" gap="3">
                    <SectionHeader title="Audio devices" subtitle="Hot-swap aware routing" />
                    <Flex align="center" justify="between" gap="3" wrap="wrap">
                      <Badge size="2" variant="outline">
                        {audioDevices.detectedInputCount} inputs · {audioDevices.detectedOutputCount} outputs
                      </Badge>
                      <Button
                        size="2"
                        variant="soft"
                        onClick={() => {
                          void refreshAudioDevices();
                        }}
                        disabled={!audioDevices.supported || isRefreshingDevices}
                      >
                        {isRefreshingDevices ? "Refreshing…" : "Refresh"}
                      </Button>
                    </Flex>
                    <Flex direction="column" gap="2">
                      <label className="device-field">
                        <Text size="2" color="gray">Input device</Text>
                        <select
                          className="device-select"
                          value={audioDevices.selectedInputId}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setSelectedInputId(nextValue);
                            void updateAudioSettings({ inputDeviceId: nextValue });
                          }}
                          disabled={!audioDevices.supported}
                        >
                          {audioDevices.inputs.map((device) => (
                            <option key={device.id} value={device.id}>
                              {device.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="device-field">
                        <Text size="2" color="gray">Output device</Text>
                        <select
                          className="device-select"
                          value={audioDevices.selectedOutputId}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setSelectedOutputId(nextValue);
                            void updateAudioSettings({ outputDeviceId: nextValue });
                          }}
                          disabled={!audioDevices.supported}
                        >
                          {audioDevices.outputs.map((device) => (
                            <option key={device.id} value={device.id}>
                              {device.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </Flex>
                    <Flex direction="column" gap="2">
                      <Flex align="center" justify="between" gap="3">
                        <Text size="2">Capture enabled</Text>
                        <Switch
                          checked={appState.audio.captureEnabled}
                          onCheckedChange={(checked) => {
                            void updateAudioSettings({ captureEnabled: checked });
                          }}
                        />
                      </Flex>
                      <Flex align="center" justify="between" gap="3">
                        <Text size="2">Self mute</Text>
                        <Switch
                          checked={appState.audio.selfMuted}
                          onCheckedChange={(checked) => {
                            void updateAudioSettings({ selfMuted: checked });
                          }}
                        />
                      </Flex>
                      <label className="device-field">
                        <Text size="2" color="gray">Input gain · {appState.audio.inputGain}%</Text>
                        <input
                          type="range"
                          min="0"
                          max="150"
                          value={appState.audio.inputGain}
                          onChange={(event) => {
                            void updateAudioSettings({ inputGain: Number(event.target.value) });
                          }}
                        />
                      </label>
                      <label className="device-field">
                        <Text size="2" color="gray">Output gain · {appState.audio.outputGain}%</Text>
                        <input
                          type="range"
                          min="0"
                          max="150"
                          value={appState.audio.outputGain}
                          onChange={(event) => {
                            void updateAudioSettings({ outputGain: Number(event.target.value) });
                          }}
                        />
                      </label>
                      <Flex direction="column" gap="2">
                        <Flex align="center" justify="between" gap="3">
                          <Text size="2">Realtime metering</Text>
                          <Badge
                            size="2"
                            variant="soft"
                            color={voiceActivation.isTransmitting ? "green" : voiceActivation.mode === "muted" ? "red" : "gray"}
                          >
                            {voiceActivationLabel}
                          </Badge>
                        </Flex>
                        <Box className="meter-stack">
                          <Box className="meter-field">
                            <Flex align="center" justify="between" gap="3">
                              <Text size="1" color="gray">Input level</Text>
                              <Text size="1" color="gray">{Math.round(voiceActivation.inputLevel * 100)}%</Text>
                            </Flex>
                            <div
                              className="audio-meter"
                              role="meter"
                              aria-label="Input level meter"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(voiceActivation.inputLevel * 100)}
                            >
                              <div className="audio-meter-fill" style={{ width: `${voiceActivation.inputLevel * 100}%` }} />
                            </div>
                          </Box>
                          <Box className="meter-field">
                            <Flex align="center" justify="between" gap="3">
                              <Text size="1" color="gray">Transmit bus</Text>
                              <Text size="1" color="gray">{Math.round(voiceActivation.outputLevel * 100)}%</Text>
                            </Flex>
                            <div
                              className="audio-meter"
                              role="meter"
                              aria-label="Transmit level meter"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(voiceActivation.outputLevel * 100)}
                            >
                              <div className="audio-meter-fill transmit" style={{ width: `${voiceActivation.outputLevel * 100}%` }} />
                            </div>
                          </Box>
                        </Box>
                        <Text size="1" color="gray">
                          {appState.preferences.pushToTalk
                            ? `Hold ${pushToTalkShortcutLabel} to open the send bus.`
                            : `Voice activity detection opens the send bus once input crosses ${Math.round(DEFAULT_VAD_START_THRESHOLD * 100)}%.`}
                        </Text>
                        {meteringError ? (
                          <Text size="1" color="ruby">{meteringError}</Text>
                        ) : null}
                      </Flex>
                    </Flex>
                    <Separator size="4" />
                    <Flex direction="column" gap="1">
                      <Text size="2" color="gray">
                        Capture route: {audioDevices.inputRoute.resolvedLabel}
                      </Text>
                      <Text size="2" color="gray">
                        Playback route: {audioDevices.outputRoute.resolvedLabel}
                      </Text>
                      <Text size="2" color="gray">
                        {outputRoutingReady
                          ? "Preview audio follows the selected output device."
                          : "Preview audio routing follows this selection when the current browser or runtime supports sink switching."}
                      </Text>
                      {audioDevices.error ? (
                        <Text size="2" color="ruby">{audioDevices.error}</Text>
                      ) : null}
                    </Flex>
                  </Flex>
                </Card>
              </Flex>
            </Card>

            <Grid columns={{ initial: "1", md: "2" }} gap="6">
              <Card className="section-card fade-in delay-1">
                <Flex direction="column" gap="4">
                  <SectionHeader
                    title="Channels"
                    subtitle={activeChannel
                      ? `Active room: ${activeChannel.name}${!activeChannel.permissions.enter ? " · no entry" : ""}`
                      : "Join a server to browse rooms"}
                  />
                  {appState.channels.length > 0 ? (
                    <Flex direction="column" gap="2">
                      {appState.channels.map((channel) => {
                        const participantCount = channel.participantIds.length;
                        const isActive = channel.id === appState.activeChannelId;
                        return (
                          <Button
                            key={channel.id}
                            variant={isActive ? "solid" : "soft"}
                            color={isActive ? "cyan" : undefined}
                            style={{
                              justifyContent: "space-between",
                              paddingLeft: `${BASE_CHANNEL_PADDING + (channel.depth * CHANNEL_INDENT_PER_LEVEL)}px`
                            }}
                            onClick={() => {
                              void selectChannel(channel.id);
                            }}
                            disabled={!channel.permissions.enter}
                          >
                            <Flex align="center" justify="between" width="100%" gap="3">
                              <Flex align="center" gap="2">
                                <span>{channel.name}</span>
                                {!channel.permissions.enter ? (
                                  <Text as="span" size="1" color="gray">Locked</Text>
                                ) : null}
                                {channel.permissions.enter && !channel.permissions.speak ? (
                                  <Text as="span" size="1" color="gray">Listen only</Text>
                                ) : null}
                              </Flex>
                              <span>{participantCount}</span>
                            </Flex>
                          </Button>
                        );
                      })}
                    </Flex>
                  ) : (
                    <Text size="2" color="gray">
                      {appState.connection.status === "connecting"
                        ? "Loading channel tree…"
                        : "No rooms yet. Connect to a server to load the current channel list."}
                    </Text>
                  )}
                </Flex>
              </Card>

              <Card className="section-card fade-in delay-1">
                <Flex direction="column" gap="4">
                  <SectionHeader
                    title="Participants"
                    subtitle={activeChannel ? `${activeParticipants.length} in ${activeChannel.name}` : "Live session roster"}
                  />
                  {activeParticipants.length > 0 ? (
                    <Flex direction="column" gap="3">
                      {activeParticipants.map((participant) => (
                        <Button
                          key={participant.id}
                          type="button"
                          variant={selectedParticipantId === participant.id ? "soft" : "ghost"}
                          onClick={() => {
                            setSelectedParticipantId(participant.id);
                            setFormError(null);
                          }}
                          style={{ justifyContent: "space-between", width: "100%", height: "auto", padding: 0 }}
                        >
                          <Flex align="center" justify="between" style={{ width: "100%", padding: "6px 0" }}>
                            <Flex align="center" gap="3">
                              <Box
                                style={{
                                  width: 38,
                                  height: 38,
                                  borderRadius: 12,
                                  background: "rgba(255,255,255,0.08)",
                                  display: "grid",
                                  placeItems: "center"
                                }}
                              >
                                <PersonIcon />
                              </Box>
                              <Box>
                                <Text size="3">{getParticipantDisplayName(participant, localNicknames)}</Text>
                                <Flex align="center" gap="2" wrap="wrap">
                                  {localNicknames[participant.id] ? (
                                    <Text size="1" color="gray">Server name: {participant.name}</Text>
                                  ) : null}
                                  {participant.isSelf ? <Text size="1" color="gray">You</Text> : null}
                                </Flex>
                              </Box>
                            </Flex>
                            <StatusChip status={participant.status} label={participant.status} />
                          </Flex>
                        </Button>
                      ))}
                    </Flex>
                  ) : (
                    <Text size="2" color="gray">
                      {appState.connection.status === "connected"
                        ? "Nobody is in the active room yet."
                        : "Disconnected. Participant presence appears here once the session is live."}
                    </Text>
                  )}
                  {selectedParticipant ? (
                    <Card className="section-card">
                      <Flex direction="column" gap="3">
                        <SectionHeader
                          title="Participant details"
                          subtitle={selectedParticipantChannel
                            ? `Currently in ${selectedParticipantChannel.name}`
                            : "User profile and local nickname"}
                        />
                        <Grid columns={{ initial: "1", sm: "2" }} gap="3">
                          <Box>
                            <Text size="1" color="gray">Display name</Text>
                            <Text size="3">{getParticipantDisplayName(selectedParticipant, localNicknames)}</Text>
                          </Box>
                          <Box>
                            <Text size="1" color="gray">Status</Text>
                            <Flex style={{ marginTop: 4 }}>
                              <StatusChip status={selectedParticipant.status} label={selectedParticipant.status} />
                            </Flex>
                          </Box>
                          <Box>
                            <Text size="1" color="gray">Server name</Text>
                            <Text size="3">{selectedParticipant.name}</Text>
                          </Box>
                          <Box>
                            <Text size="1" color="gray">Participant ID</Text>
                            <Text size="2" style={{ wordBreak: "break-all" }}>{selectedParticipant.id}</Text>
                          </Box>
                        </Grid>
                        <Box>
                          <Text size="1" color="gray">Local nickname</Text>
                          <TextField.Root
                            value={participantNicknameDraft}
                            placeholder="Add a local alias for this user"
                            onChange={(event) => {
                              setParticipantNicknameDraft(event.target.value);
                            }}
                            style={{ marginTop: 8 }}
                          >
                            <TextField.Slot>
                              <PersonIcon />
                            </TextField.Slot>
                          </TextField.Root>
                        </Box>
                        <Flex gap="3" wrap="wrap">
                          <Button
                            type="button"
                            onClick={() => {
                              void saveLocalNickname();
                            }}
                          >
                            Save nickname
                          </Button>
                          <Button
                            type="button"
                            variant="soft"
                            onClick={() => {
                              setParticipantNicknameDraft("");
                              void updatePreferences({
                                localNicknames: withParticipantLocalNickname(
                                  localNicknames,
                                  selectedParticipant.id,
                                  ""
                                )
                              });
                            }}
                            disabled={!localNicknames[selectedParticipant.id]}
                          >
                            Clear nickname
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setSelectedParticipantId(null);
                            }}
                          >
                            Close
                          </Button>
                        </Flex>
                      </Flex>
                    </Card>
                  ) : null}
                </Flex>
              </Card>

              <Card className="section-card fade-in delay-2">
                <Flex direction="column" gap="4">
                  <SectionHeader
                    title="Chat"
                    subtitle={activeChannel ? `Messages in ${activeChannel.name}` : "Basic room chat"}
                  />
                  {activeMessages.length > 0 ? (
                    <Flex direction="column" gap="3" style={{ maxHeight: 280, overflowY: "auto", paddingRight: 4 }}>
                      {activeMessages.map((message) => (
                        <Card key={message.id} className="section-card">
                          <Flex direction="column" gap="2">
                            <Flex align="center" justify="between" gap="3">
                              <Flex align="center" gap="2">
                                <Text size="2" weight="bold">{message.author}</Text>
                                {message.isSelf ? <Badge size="1" variant="soft">You</Badge> : null}
                              </Flex>
                              <Text size="1" color="gray">{formatChatTimestamp(message.sentAt)}</Text>
                            </Flex>
                            <Text size="2">{message.body}</Text>
                            {message.channelId === null ? (
                              <Text size="1" color="gray">Server notice</Text>
                            ) : null}
                          </Flex>
                        </Card>
                      ))}
                    </Flex>
                  ) : (
                    <Text size="2" color="gray">
                      {appState.connection.status === "connected"
                        ? "No chat in the active room yet."
                        : "Connect to a server to load room chat."}
                    </Text>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendChatMessage();
                    }}
                  >
                    <Flex direction={{ initial: "column", sm: "row" }} gap="3">
                      <TextField.Root
                        placeholder={activeChannel ? `Message ${activeChannel.name}` : "Message the active room"}
                        value={chatDraft}
                        onChange={(event) => {
                          setChatDraft(event.target.value);
                        }}
                        disabled={appState.connection.status !== "connected"}
                        style={{ flex: 1 }}
                      >
                        <TextField.Slot>
                          <ChatBubbleIcon />
                        </TextField.Slot>
                      </TextField.Root>
                      <Button type="submit" disabled={appState.connection.status !== "connected"}>
                        Send
                      </Button>
                    </Flex>
                  </form>
                </Flex>
              </Card>

              <Card className="section-card fade-in delay-2">
                <Flex direction="column" gap="4">
                  <SectionHeader
                    title="Audio chain"
                    subtitle="Realtime processing controls"
                    action={<IconButton variant="ghost"><MixerHorizontalIcon /></IconButton>}
                  />
                  <Grid columns={{ initial: "1", sm: "2" }} gap="3">
                    {audioPresets.map((preset) => (
                      <Card key={preset.label} className="section-card">
                        <Flex direction="column" gap="2">
                          <Text weight="bold">{preset.label}</Text>
                          <Text size="2" color="gray">{preset.description}</Text>
                          <Button
                            variant="soft"
                            size="2"
                            onClick={() => {
                              applyPreset(preset.settings);
                            }}
                          >
                            Apply
                          </Button>
                        </Flex>
                      </Card>
                    ))}
                  </Grid>
                  <Separator size="4" />
                  <SectionHeader
                    title="DSP pipeline"
                    subtitle="Local voice processing controls"
                    action={<IconButton variant="ghost"><MixerHorizontalIcon /></IconButton>}
                  />
                  <Flex direction="column" gap="3">
                    {dspFeatures.map((feature) => (
                      <Flex key={feature.key} align="center" justify="between" gap="3">
                        <Box style={{ flex: 1 }}>
                          <Text size="2">{feature.label}</Text>
                          <Text size="1" color="gray">{feature.description}</Text>
                        </Box>
                        <Switch
                          checked={dspPipeline.settings[feature.key]}
                          onCheckedChange={(enabled) => {
                            const nextPipeline = setDspFeature(dspPipeline.settings, feature.key, enabled);
                            setDspPipelineState(nextPipeline);
                            void updatePreferences({
                              voiceProcessing: persistDspSettings(nextPipeline.settings)
                            });
                          }}
                        />
                      </Flex>
                    ))}
                  </Flex>
                  <Separator size="4" />
                  <Flex align="start" justify="between" gap="3">
                    <Text size="2" color="gray">Pipeline status</Text>
                    <Flex gap="2" wrap="wrap" justify="end">
                      {dspPipeline.isBypassed
                        ? <Badge size="2" variant="soft" color="gray">Bypassed</Badge>
                        : dspPipeline.activeStages.map((stage) => (
                          <Badge key={stage} size="2" variant="outline">{stage}</Badge>
                        ))}
                    </Flex>
                  </Flex>
                </Flex>
              </Card>

              <div ref={diagnosticsSectionRef}>
                <Card className="section-card fade-in delay-3">
                  <Flex direction="column" gap="4">
                    <SectionHeader title="Quick actions" subtitle="Renderer-driven session controls" />
                    <Grid columns={{ initial: "1", sm: "2" }} gap="3">
                      <QuickAction
                        title="Mute"
                        description={appState.audio.selfMuted ? "Unmute microphone" : "Mute microphone"}
                        icon={<SpeakerOffIcon />}
                        active={appState.audio.selfMuted}
                        onClick={() => {
                          void updateAudioSettings({ selfMuted: !appState.audio.selfMuted });
                        }}
                      />
                      <QuickAction
                        title="Output"
                        description="Route back to the system output"
                        icon={<SpeakerLoudIcon />}
                        active={appState.audio.outputDeviceId === SYSTEM_DEFAULT_DEVICE_ID}
                        onClick={() => {
                          void updateAudioSettings({ outputDeviceId: SYSTEM_DEFAULT_DEVICE_ID });
                        }}
                      />
                      <QuickAction
                        title="Latency"
                        description={appState.preferences.showLatencyDetails ? "Hide diagnostics" : "Show diagnostics"}
                        icon={<LightningBoltIcon />}
                        active={appState.preferences.showLatencyDetails}
                        onClick={() => {
                          void updatePreferences({ showLatencyDetails: !appState.preferences.showLatencyDetails });
                        }}
                      />
                      <QuickAction
                        title="Rooms"
                        description={activeChannel ? `Switch from ${activeChannel.name}` : "Cycle the active room"}
                        icon={<ChatBubbleIcon />}
                        onClick={() => {
                          void cycleChannel();
                        }}
                      />
                    </Grid>
                    {appState.preferences.showLatencyDetails ? (
                      <Card className="section-card">
                        <Flex direction="column" gap="3">
                          <Text size="2">Latency: {appState.telemetry.latencyMs ?? "—"} ms</Text>
                          <Text size="2">Jitter: {appState.telemetry.jitterMs ?? "—"} ms</Text>
                          <Text size="2">Packet loss: {appState.telemetry.packetLoss ?? "—"}%</Text>
                          <Flex gap="3" wrap="wrap" align="center">
                            <Button
                              variant="soft"
                              onClick={() => {
                                void exportDiagnostics();
                              }}
                              disabled={!window.app?.exportDiagnostics || isExportingDiagnostics}
                            >
                              <DownloadIcon />
                              {isExportingDiagnostics ? "Exporting…" : "Export diagnostics"}
                            </Button>
                            <Text size="1" color="gray">
                              Includes structured logs plus network and audio diagnostics for bug reports.
                            </Text>
                          </Flex>
                          {diagnosticsMessage ? (
                            <Text size="1" color="green">{diagnosticsMessage}</Text>
                          ) : null}
                          {diagnosticsError ? (
                            <Text size="1" color="ruby">{diagnosticsError}</Text>
                          ) : null}
                        </Flex>
                      </Card>
                    ) : null}
                  </Flex>
                </Card>
              </div>

              <Card className="section-card fade-in delay-3">
                <Flex direction="column" gap="4">
                    <SectionHeader title="Preferences" subtitle="Saved with recent server details" />
                  <Flex direction="column" gap="3">
                    <Flex align="center" justify="between" gap="3">
                      <Box>
                        <Text size="2">Push to talk</Text>
                        <Text size="1" color="gray">Require a hold-to-speak workflow.</Text>
                      </Box>
                      <Switch
                        checked={appState.preferences.pushToTalk}
                        onCheckedChange={(checked) => {
                          void updatePreferences({ pushToTalk: checked });
                        }}
                        />
                      </Flex>
                      <label className="device-field">
                        <Text size="2" color="gray">PTT shortcut</Text>
                        <input
                          className="device-select"
                          type="text"
                          value={pushToTalkShortcutLabel}
                          readOnly
                          onFocus={(event) => {
                            event.currentTarget.select();
                          }}
                          onKeyDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();

                            if (event.key === "Backspace" || event.key === "Delete") {
                              void updatePreferences({ pushToTalkShortcut: DEFAULT_PUSH_TO_TALK_SHORTCUT });
                              return;
                            }

                            const nextShortcut = shortcutFromKeyboardEvent(event.nativeEvent);
                            if (!nextShortcut) {
                              return;
                            }

                            void updatePreferences({ pushToTalkShortcut: nextShortcut });
                          }}
                        />
                      </label>
                      <Text size="1" color="gray">
                        Focus the shortcut field and press any key to set it as your push-to-talk shortcut. Press Backspace or Delete to reset to Space. Current switch state: {pushToTalkPressed ? "Held" : "Released"}.
                      </Text>
                      <Flex direction="column" gap="3">
                        <Box>
                          <Text size="2">Shortcut targets</Text>
                          <Text size="1" color="gray">
                            Add renderer shortcuts for quick actions like mute, diagnostics, output routing, and channel cycling.
                          </Text>
                        </Box>
                        {shortcutBindings.length === 0 ? (
                          <Text size="1" color="gray">
                            No quick-action shortcuts configured yet. Add one to capture a key and route it to an existing quick action.
                          </Text>
                        ) : shortcutBindings.map((binding) => {
                          const targetOption = getShortcutTargetOption(binding.target);

                          return (
                            <Card key={binding.target} className="section-card">
                              <Flex direction="column" gap="3">
                                <Grid columns={{ initial: "1", md: "2" }} gap="3">
                                  <label className="device-field">
                                    <Text size="2" color="gray">Target</Text>
                                    <select
                                      className="device-select"
                                      value={binding.target}
                                      onChange={(event) => {
                                        updateShortcutBindingTarget(
                                          binding.target,
                                          event.target.value as AppClientShortcutBinding["target"]
                                        );
                                      }}
                                    >
                                      {shortcutTargetOptions.map((option) => (
                                        <option
                                          key={option.value}
                                          value={option.value}
                                          disabled={option.value !== binding.target && shortcutBindings.some((candidate) => (
                                            candidate.target === option.value
                                          ))}
                                        >
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="device-field">
                                    <Text size="2" color="gray">Shortcut</Text>
                                    <input
                                      className="device-select"
                                      type="text"
                                      value={formatPushToTalkShortcut(binding.shortcut)}
                                      readOnly
                                      onFocus={(event) => {
                                        event.currentTarget.select();
                                      }}
                                      onKeyDown={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();

                                        if (event.key === "Backspace" || event.key === "Delete") {
                                          updateShortcutBindingShortcut(
                                            binding.target,
                                            getDefaultShortcutBinding(binding.target).shortcut
                                          );
                                          return;
                                        }

                                        const nextShortcut = shortcutFromKeyboardEvent(event.nativeEvent);
                                        if (!nextShortcut) {
                                          return;
                                        }

                                        updateShortcutBindingShortcut(binding.target, nextShortcut);
                                      }}
                                    />
                                  </label>
                                </Grid>
                                <Flex align="center" justify="between" gap="3" wrap="wrap">
                                  <Text size="1" color="gray">
                                    {targetOption?.description ?? "Route the shortcut to a quick action target."}
                                  </Text>
                                  <Button
                                    variant="ghost"
                                    color="ruby"
                                    size="2"
                                    onClick={() => {
                                      removeShortcutBinding(binding.target);
                                    }}
                                  >
                                    Remove
                                  </Button>
                                </Flex>
                              </Flex>
                            </Card>
                          );
                        })}
                        <Flex gap="2" wrap="wrap">
                          <Button
                            variant="soft"
                            size="2"
                            onClick={addShortcutBinding}
                            disabled={shortcutBindings.length >= shortcutTargetOptions.length}
                          >
                            Add shortcut
                          </Button>
                          <Button
                            variant="ghost"
                            size="2"
                            onClick={() => {
                              updateShortcutBindings([]);
                            }}
                            disabled={shortcutBindings.length === 0}
                          >
                            Clear all
                          </Button>
                        </Flex>
                      </Flex>
                      <Flex align="center" justify="between" gap="3">
                        <Box>
                          <Text size="2">Auto reconnect</Text>
                        <Text size="1" color="gray">Retry the last server automatically.</Text>
                      </Box>
                      <Switch
                        checked={appState.preferences.autoReconnect}
                        onCheckedChange={(checked) => {
                          void updatePreferences({ autoReconnect: checked });
                        }}
                      />
                    </Flex>
                    <Flex align="center" justify="between" gap="3">
                      <Box>
                        <Text size="2">Notifications</Text>
                        <Text size="1" color="gray">Show desktop notices for room changes.</Text>
                      </Box>
                      <Switch
                        checked={appState.preferences.notificationsEnabled}
                        onCheckedChange={(checked) => {
                          void updatePreferences({ notificationsEnabled: checked });
                        }}
                      />
                    </Flex>
                    <Text size="2" color="gray">
                      Favorites: {favoriteServers.length > 0
                        ? favoriteServers.map((favoriteServer) => favoriteServer.label).join(" • ")
                        : "None yet"}
                    </Text>
                    <Text size="2" color="gray">
                      Recent servers: {appState.recentServers.length > 0 ? appState.recentServers.join(" • ") : "None yet"}
                    </Text>
                  </Flex>
                </Flex>
              </Card>

              <Card className="section-card fade-in delay-3">
                <Flex direction="column" gap="4">
                  <SectionHeader title="Secure transport" subtitle="Authenticated handshake + encrypted UDP" />
                  <Text size="2" color="gray">
                    The Electron shell can now run an authenticated voice self-test that derives fresh
                    session keys and encrypts a UDP voice round trip end-to-end.
                  </Text>
                  <Flex direction="column" gap="2">
                    <Flex gap="3" wrap="wrap">
                      <Button
                        variant="solid"
                        onClick={() => {
                          void runSelfTest();
                        }}
                        disabled={!window.app?.runSecureVoiceSelfTest || handshakeState === "running"}
                      >
                        {handshakeState === "running" ? "Running secure self-test…" : "Run auth self-test"}
                      </Button>
                      <Button variant="soft" disabled>
                        {window.app?.runSecureVoiceSelfTest ? "Electron transport available" : "Open in Electron to test"}
                      </Button>
                    </Flex>
                    {selfTestResult ? (
                      <Card className="section-card">
                        <Flex direction="column" gap="2">
                          <Text size="2" color="gray">Session ID</Text>
                          <Text size="2">{selfTestResult.sessionId}</Text>
                          <Text size="2" color="gray">Echoed payload</Text>
                          <Text size="2">{selfTestResult.echoedPayload}</Text>
                          <Text size="2" color="gray">{selfTestResult.cipherSuite}</Text>
                        </Flex>
                      </Card>
                    ) : null}
                    {selfTestError ? (
                      <Text size="2" color="ruby">{selfTestError}</Text>
                    ) : null}
                  </Flex>
                </Flex>
              </Card>
            </Grid>
          </Flex>
        </main>
      </Box>
    </Theme>
  );
}
