import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  IconButton,
  Switch,
  Text,
  TextField,
  Theme,
} from "@radix-ui/themes";
import {
  ChatBubbleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Cross2Icon,
  DownloadIcon,
  GlobeIcon,
  LightningBoltIcon,
  MinusIcon,
  OpenInNewWindowIcon,
  PersonIcon,
  SpeakerOffIcon,
} from "@radix-ui/react-icons";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  appendLocalChatMessageState,
} from "../electron/appClientState.js";
import {
  applyOutputDeviceSelection,
  buildAudioDeviceState,
  createInputDeviceConstraints,
  subscribeToAudioDeviceChanges,
  SYSTEM_DEFAULT_DEVICE_ID,
  type BrowserAudioDevice,
} from "./audioDevices";
import { SectionHeader } from "./components/SectionHeader";
import { StatusChip } from "./components/StatusChip";
import { buildFailedConnectionRecovery } from "./connectionRecovery";
import {
  createDspPipeline,
  dspFeatures,
  loadDspSettings,
  loadDspPipeline,
  persistDspSettings,
  setDspFeature,
} from "./dspPipeline.mjs";
import {
  findNextShortcutTarget,
  getDefaultShortcutBinding,
  getShortcutTargetOption,
  shortcutTargetOptions,
} from "./shortcutBindings";
import {
  createInitialVoiceActivationState,
  DEFAULT_PUSH_TO_TALK_SHORTCUT,
  DEFAULT_VAD_START_THRESHOLD,
  formatPushToTalkShortcut,
  matchesPushToTalkShortcut,
  shortcutFromKeyboardEvent,
  stepVoiceActivation,
} from "./voiceActivation";
import {
  describeTalkMode,
  describeTransportStatus,
  findNextNavigableChannel,
  formatTransportActivity,
} from "./sessionQuickActions";
import {
  getChatMessagesForTarget,
  getChatTargetKey,
  getChatViewTarget,
  getUnreadCountForTarget,
} from "./chatState";
import {
  getCompactChatLogMessages,
  shouldExpandConnectionControls,
} from "./minimalUi";
import {
  buildBase16ThemeVariables,
  clearStoredBase16Theme,
  loadStoredBase16Theme,
  parseBase16Theme,
  storeBase16Theme,
  type Base16Theme,
} from "./base16Theme.js";

const TALKING_POPOUT_VIEW = "talking-popout";
const getCurrentView = () =>
  new URLSearchParams(window.location.search).get("view");

const fallbackAppState: AppClientState = {
  connection: {
    status: "disconnected",
    serverAddress: "",
    nickname: "",
    error: null,
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
    outputGain: 100,
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
    voiceProcessing: loadDspSettings(),
  },
  telemetry: {
    latencyMs: null,
    jitterMs: null,
    packetLoss: null,
  },
  recentServers: [],
};

const audioPresets = [
  {
    label: "Studio clarity",
    description: "Wideband, low noise gate",
    settings: {
      agc: true,
      noiseSuppression: true,
      echoCancellation: false,
    },
  },
  {
    label: "Party mode",
    description: "Boost presence and limiter",
    settings: {
      agc: true,
      noiseSuppression: true,
      echoCancellation: true,
    },
  },
  {
    label: "Late night",
    description: "Soft compressor, warm EQ",
    settings: {
      agc: false,
      noiseSuppression: true,
      echoCancellation: true,
    },
  },
] as const;

const ANALYSER_SMOOTHING_CONSTANT = 0.85;
const RMS_TO_LEVEL_SCALING_FACTOR = 4.5;
const VOICE_CAPTURE_TIMESLICE_MS = 250;
const BASE_CHANNEL_PADDING = 12;
const CHANNEL_INDENT_PER_LEVEL = 12;
const PARTICIPANT_INDENT_OFFSET = 18;
const MAX_ACTIVITY_LOG_MESSAGES = 12;
const DOCK_PANEL_MIN_WIDTH = 240;
const DOCK_PANEL_MIN_HEIGHT = 180;
const DOCK_PANEL_MINIMIZED_HEIGHT = 48;
const PREFERRED_VOICE_CAPTURE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
] as const;

type DockPanelId = "log" | "chat" | "self";

type DockPanelLayout = {
  offsetX: number;
  offsetY: number;
  width: number | null;
  height: number;
  isClosed: boolean;
  isMinimized: boolean;
  zIndex: number;
};

type DockPanelInteraction = {
  panelId: DockPanelId;
  mode: "move" | "resize";
  startClientX: number;
  startClientY: number;
  startOffsetX: number;
  startOffsetY: number;
  startWidth: number;
  startHeight: number;
};

const createInitialDockPanelLayouts = (): Record<DockPanelId, DockPanelLayout> => ({
  log: {
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: 260,
    isClosed: false,
    isMinimized: false,
    zIndex: 1,
  },
  chat: {
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: 260,
    isClosed: false,
    isMinimized: false,
    zIndex: 2,
  },
  self: {
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: 260,
    isClosed: false,
    isMinimized: false,
    zIndex: 3,
  },
});

const DOCK_PANEL_TITLES: Record<DockPanelId, string> = {
  log: "Log",
  chat: "Chatbar",
  self: "Self / Configure",
};

const statusCopy: Record<AppClientConnectionState["status"], string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  authenticating: "Authenticating…",
  connected: "Connected",
  error: "Needs attention",
};

const isConnectionBusy = (status: AppClientConnectionState["status"]) =>
  status === "connecting" || status === "authenticating";

const buildRecentServers = (recentServers: string[], serverAddress: string) => {
  const normalizedAddress = serverAddress.trim();
  return [
    normalizedAddress,
    ...recentServers.filter((value) => value !== normalizedAddress),
  ].slice(0, 5);
};

const buildFavoriteServers = (
  favoriteServers: AppClientPreferences["favoriteServers"],
  serverAddress: string,
) => {
  const normalizedAddress = serverAddress.trim();
  if (normalizedAddress.length === 0) {
    return favoriteServers;
  }

  const existingFavorite = favoriteServers.find(
    (favoriteServer) => favoriteServer.address === normalizedAddress,
  );
  return [
    {
      address: normalizedAddress,
      label: existingFavorite?.label ?? normalizedAddress,
    },
    ...favoriteServers.filter(
      (favoriteServer) => favoriteServer.address !== normalizedAddress,
    ),
  ].slice(0, 10);
};

const formatChatTimestamp = (value: string) => {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "just now";
  }

  return timestamp.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
};

const getParticipantDisplayName = (
  participant: AppClientParticipant,
  localNicknames: AppClientPreferences["localNicknames"],
) => localNicknames[participant.id] ?? participant.name;

const withParticipantLocalNickname = (
  localNicknames: AppClientPreferences["localNicknames"],
  participantId: string,
  nickname: string,
) => {
  const normalizedNickname = nickname.trim();
  if (normalizedNickname.length === 0) {
    return Object.fromEntries(
      Object.entries(localNicknames).filter(
        ([storedParticipantId]) => storedParticipantId !== participantId,
      ),
    );
  }

  return {
    ...localNicknames,
    [participantId]: normalizedNickname,
  };
};
const getParticipantStatusLabel = (participant: AppClientParticipant) => {
  switch (participant.status) {
    case "live":
      return "Speaking";
    case "muted":
      return "Muted";
    case "idle":
    default:
      return "Idle";
  }
};
const getParticipantStateLabels = (participant: AppClientParticipant) => {
  const labels: string[] = [];
  if (participant.isSelf) {
    labels.push("You");
  }
  if (participant.isSelfDeafened) {
    labels.push("Self deafened");
  } else if (participant.isDeafened) {
    labels.push("Deafened by server");
  }
  if (participant.isSelfMuted) {
    labels.push("Self muted");
  } else if (participant.isMuted) {
    labels.push("Muted by server");
  }
  if (participant.isSuppressed) {
    labels.push("Suppressed");
  }

  return labels;
};

const talkingParticipantOrder: Record<AppClientParticipant["status"], number> = {
  live: 0,
  muted: 1,
  idle: 2,
};

const getVoiceActivationLabel = (
  mode: ReturnType<typeof createInitialVoiceActivationState>["mode"],
) => {
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

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT");

export function App() {
  const [handshakeState, setHandshakeState] = useState<
    "idle" | "running" | "success" | "error"
  >("idle");
  const [selfTestResult, setSelfTestResult] =
    useState<SecureVoiceSelfTestResult | null>(null);
  const [selfTestError, setSelfTestError] = useState<string | null>(null);
  const platformLabel =
    typeof window !== "undefined" && window.app ? window.app.platform : "web";
  const mediaDevices =
    typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  const [enumeratedDevices, setEnumeratedDevices] = useState<
    BrowserAudioDevice[]
  >([]);
  const [selectedInputId, setSelectedInputId] = useState(
    SYSTEM_DEFAULT_DEVICE_ID,
  );
  const [selectedOutputId, setSelectedOutputId] = useState(
    SYSTEM_DEFAULT_DEVICE_ID,
  );
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isRefreshingDevices, setIsRefreshingDevices] = useState(false);
  const [outputRoutingReady, setOutputRoutingReady] = useState(false);
  const [appState, setAppState] = useState<AppClientState>(fallbackAppState);
  const [isLoadingAppState, setIsLoadingAppState] = useState(
    Boolean(window.app?.getState),
  );
  const [serverAddress, setServerAddress] = useState("");
  const [nickname, setNickname] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<string | null>(
    null,
  );
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [dspPipeline, setDspPipelineState] = useState(() => loadDspPipeline());
  const [voiceActivation, setVoiceActivation] = useState(() =>
    createInitialVoiceActivationState(),
  );
  const [meteringError, setMeteringError] = useState<string | null>(null);
  const [voiceTransportStatus, setVoiceTransportStatus] =
    useState<VoiceTransportStatus | null>(null);
  const [voicePlaybackError, setVoicePlaybackError] = useState<string | null>(
    null,
  );
  const [pushToTalkPressed, setPushToTalkPressed] = useState(false);
  const [selectedParticipantId, setSelectedParticipantId] = useState<
    string | null
  >(null);
  const [readChatMessageIdsByTarget, setReadChatMessageIdsByTarget] = useState<
    Record<string, string[]>
  >({});
  const [participantNicknameDraft, setParticipantNicknameDraft] = useState("");
  const [themeError, setThemeError] = useState<string | null>(null);
  const [themeMessage, setThemeMessage] = useState<string | null>(null);
  const [importedTheme, setImportedTheme] = useState<Base16Theme | null>(() =>
    typeof window === "undefined"
      ? null
      : loadStoredBase16Theme(window.localStorage),
  );
  const [isConnectionPanelExpanded, setIsConnectionPanelExpanded] = useState(true);
  const [isActivityLogExpanded, setIsActivityLogExpanded] = useState(true);
  const [isChatLogExpanded, setIsChatLogExpanded] = useState(true);
  const [dockPanels, setDockPanels] = useState<Record<DockPanelId, DockPanelLayout>>(
    () => createInitialDockPanelLayouts(),
  );
  const [activeDockInteraction, setActiveDockInteraction] =
    useState<DockPanelInteraction | null>(null);
  const outputPreviewRef = useRef<HTMLAudioElement>(null);
  const diagnosticsSectionRef = useRef<HTMLDivElement>(null);
  const dockPanelRefs = useRef<Record<DockPanelId, HTMLDivElement | null>>({
    log: null,
    chat: null,
    self: null,
  });
  const pushToTalkPressedRef = useRef(false);
  const voiceActivationRef = useRef(voiceActivation);
  const voiceCaptureMimeTypeRef = useRef<string | null>(null);
  const playbackQueueRef = useRef<string[]>([]);
  const activePlaybackUrlRef = useRef<string | null>(null);
  const isPlaybackActiveRef = useRef(false);
  const [dismissedConnectionErrorKey, setDismissedConnectionErrorKey] =
    useState<string | null>(null);
  const audioSettingsRef = useRef({
    captureEnabled: fallbackAppState.audio.captureEnabled,
    selfMuted: fallbackAppState.audio.selfMuted,
    inputGain: fallbackAppState.audio.inputGain,
    outputGain: fallbackAppState.audio.outputGain,
    pushToTalk: fallbackAppState.preferences.pushToTalk,
  });
  const audioDevices = useMemo(
    () =>
      buildAudioDeviceState(
        enumeratedDevices,
        {
          inputId: selectedInputId,
          outputId: selectedOutputId,
        },
        {
          supported: Boolean(mediaDevices?.enumerateDevices),
          error: mediaDevices?.enumerateDevices
            ? audioError
            : "Audio device APIs are unavailable in this runtime.",
        },
      ),
    [
      audioError,
      enumeratedDevices,
      mediaDevices?.enumerateDevices,
      selectedInputId,
      selectedOutputId,
    ],
  );

  const syncFormState = useCallback((state: AppClientState) => {
    setServerAddress(
      (currentValue) =>
        currentValue ||
        state.connection.serverAddress ||
        state.recentServers[0] ||
        state.preferences.favoriteServers[0]?.address ||
        "",
    );
    setNickname((currentValue) => currentValue || state.connection.nickname);
  }, []);

  const updateLocalAppState = useCallback(
    (updater: (state: AppClientState) => AppClientState) => {
      setAppState((currentState) => updater(currentState));
    },
    [],
  );

  const clearBufferedPlayback = useCallback(() => {
    const audioElement = outputPreviewRef.current;

    playbackQueueRef.current.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    playbackQueueRef.current = [];
    isPlaybackActiveRef.current = false;

    if (activePlaybackUrlRef.current) {
      URL.revokeObjectURL(activePlaybackUrlRef.current);
      activePlaybackUrlRef.current = null;
    }

    if (audioElement) {
      audioElement.pause();
      audioElement.removeAttribute("src");
      audioElement.load();
    }
  }, []);

  const playQueuedPlayback = useCallback(function playQueuedPlayback() {
    const audioElement = outputPreviewRef.current;
    if (!audioElement || isPlaybackActiveRef.current) {
      return;
    }

    const nextUrl = playbackQueueRef.current.shift();
    if (!nextUrl) {
      return;
    }

    if (activePlaybackUrlRef.current) {
      URL.revokeObjectURL(activePlaybackUrlRef.current);
    }

    activePlaybackUrlRef.current = nextUrl;
    isPlaybackActiveRef.current = true;
    audioElement.src = nextUrl;

    void audioElement
      .play()
      .then(() => {
        setVoicePlaybackError(null);
      })
      .catch((error) => {
        isPlaybackActiveRef.current = false;
        if (activePlaybackUrlRef.current) {
          URL.revokeObjectURL(activePlaybackUrlRef.current);
          activePlaybackUrlRef.current = null;
        }
        setVoicePlaybackError(
          error instanceof Error
            ? error.message
            : "Unable to play remote audio.",
        );
        playQueuedPlayback();
      });
  }, []);

  const enqueuePlaybackBlob = useCallback(
    (blob: Blob) => {
      playbackQueueRef.current.push(URL.createObjectURL(blob));
      playQueuedPlayback();
    },
    [playQueuedPlayback],
  );

  const updateAudioSettings = useCallback(
    async (audio: Partial<AppClientAudioSettings>) => {
      if (window.app?.updateAudioSettings) {
        const nextState = await window.app.updateAudioSettings(audio);
        setAppState(nextState);
        return;
      }

      updateLocalAppState((currentState) => ({
        ...currentState,
        audio: {
          ...currentState.audio,
          ...audio,
        },
      }));
    },
    [updateLocalAppState],
  );

  const updatePreferences = useCallback(
    async (preferences: Partial<AppClientPreferences>) => {
      updateLocalAppState((currentState) => ({
        ...currentState,
        preferences: {
          ...currentState.preferences,
          ...preferences,
        },
      }));
    },
    [updateLocalAppState],
  );

  const updateFavoriteServers = useCallback(
    (favoriteServers: AppClientPreferences["favoriteServers"]) => {
      void updatePreferences({ favoriteServers });
    },
    [updatePreferences],
  );

  const rememberServer = useCallback(
    async (nextServerAddress: string) => {
      const normalizedServerAddress = nextServerAddress.trim();
      if (normalizedServerAddress.length === 0) {
        return;
      }

      if (window.app?.rememberServer) {
        const nextState = await window.app.rememberServer(
          normalizedServerAddress,
        );
        setAppState(nextState);
        setServerAddress(nextState.connection.serverAddress);
        return;
      }

      updateLocalAppState((currentState) => ({
        ...currentState,
        connection: {
          ...currentState.connection,
          serverAddress: normalizedServerAddress,
        },
        recentServers: buildRecentServers(
          currentState.recentServers,
          normalizedServerAddress,
        ),
      }));
      setServerAddress(normalizedServerAddress);
    },
    [updateLocalAppState],
  );

  const loadRecentServer = useCallback((recentServer: string) => {
    setServerAddress(recentServer);
    setFormError(null);
  }, []);

  const loadFavoriteServer = useCallback(
    (favoriteServer: AppClientPreferences["favoriteServers"][number]) => {
      setServerAddress(favoriteServer.address);
      setFormError(null);
    },
    [],
  );

  const saveFavoriteServer = useCallback(() => {
    updateFavoriteServers(
      buildFavoriteServers(appState.preferences.favoriteServers, serverAddress),
    );
  }, [
    appState.preferences.favoriteServers,
    serverAddress,
    updateFavoriteServers,
  ]);

  const removeFavoriteServer = useCallback(
    (favoriteAddress: string) => {
      updateFavoriteServers(
        appState.preferences.favoriteServers.filter(
          (favoriteServer) => favoriteServer.address !== favoriteAddress,
        ),
      );
    },
    [appState.preferences.favoriteServers, updateFavoriteServers],
  );

  useEffect(() => {
    audioSettingsRef.current = {
      captureEnabled: appState.audio.captureEnabled,
      selfMuted: appState.audio.selfMuted,
      inputGain: appState.audio.inputGain,
      outputGain: appState.audio.outputGain,
      pushToTalk: appState.preferences.pushToTalk,
    };
  }, [
    appState.audio.captureEnabled,
    appState.audio.inputGain,
    appState.audio.outputGain,
    appState.audio.selfMuted,
    appState.preferences.pushToTalk,
  ]);

  useEffect(() => {
    pushToTalkPressedRef.current = pushToTalkPressed;
  }, [pushToTalkPressed]);

  useEffect(() => {
    voiceActivationRef.current = voiceActivation;
  }, [voiceActivation]);

  useEffect(() => {
    setIsConnectionPanelExpanded(
      shouldExpandConnectionControls(appState.connection.status),
    );
  }, [appState.connection.status]);

  useEffect(() => {
    setDspPipelineState(
      createDspPipeline(appState.preferences.voiceProcessing),
    );
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
      setAudioError(
        error instanceof Error
          ? error.message
          : "Unable to refresh audio devices.",
      );
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
  }, [
    appState.audio.inputDeviceId,
    appState.audio.outputDeviceId,
    selectedInputId,
    selectedOutputId,
  ]);

  useEffect(() => {
    if (audioDevices.selectedInputId !== selectedInputId) {
      setSelectedInputId(audioDevices.selectedInputId);
    }

    if (audioDevices.selectedOutputId !== selectedOutputId) {
      setSelectedOutputId(audioDevices.selectedOutputId);
    }
  }, [
    audioDevices.selectedInputId,
    audioDevices.selectedOutputId,
    selectedInputId,
    selectedOutputId,
  ]);

  useEffect(() => {
    let active = true;

    const syncOutputRoute = async () => {
      try {
        const applied = await applyOutputDeviceSelection(
          outputPreviewRef.current,
          audioDevices.selectedOutputId,
        );
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
    const audioElement = outputPreviewRef.current;
    if (!audioElement) {
      return undefined;
    }

    const handleEnded = () => {
      isPlaybackActiveRef.current = false;
      if (activePlaybackUrlRef.current) {
        URL.revokeObjectURL(activePlaybackUrlRef.current);
        activePlaybackUrlRef.current = null;
      }
      playQueuedPlayback();
    };
    const handleError = () => {
      isPlaybackActiveRef.current = false;
      if (activePlaybackUrlRef.current) {
        URL.revokeObjectURL(activePlaybackUrlRef.current);
        activePlaybackUrlRef.current = null;
      }
      setVoicePlaybackError("Remote audio playback failed.");
      playQueuedPlayback();
    };

    audioElement.addEventListener("ended", handleEnded);
    audioElement.addEventListener("error", handleError);

    return () => {
      audioElement.removeEventListener("ended", handleEnded);
      audioElement.removeEventListener("error", handleError);
      clearBufferedPlayback();
    };
  }, [clearBufferedPlayback, playQueuedPlayback]);

  useEffect(() => {
    if (!window.voice) {
      return undefined;
    }

    let active = true;

    const syncVoiceStatus = async () => {
      try {
        const status = await window.voice?.getStatus();
        if (active && status) {
          setVoiceTransportStatus(status);
        }
      } catch (error) {
        if (active) {
          setVoicePlaybackError(
            error instanceof Error
              ? error.message
              : "Unable to query voice transport status.",
          );
        }
      }
    };

    void syncVoiceStatus();
    const unsubscribeStatus = window.voice.onStatus((status) => {
      if (active) {
        setVoiceTransportStatus(status);
      }
    });
    const unsubscribeMessage = window.voice.onMessage((packet) => {
      const mimeType = voiceCaptureMimeTypeRef.current;
      if (!active || !mimeType) {
        return;
      }

      enqueuePlaybackBlob(new Blob([packet.payload], { type: mimeType }));
    });

    return () => {
      active = false;
      unsubscribeStatus();
      unsubscribeMessage();
      clearBufferedPlayback();
    };
  }, [clearBufferedPlayback, enqueuePlaybackBlob]);

  useEffect(() => {
    if (appState.connection.status !== "connected") {
      voiceCaptureMimeTypeRef.current = null;
      clearBufferedPlayback();
    }
  }, [appState.connection.status, clearBufferedPlayback]);

  useEffect(() => {
    if (!appState.preferences.pushToTalk) {
      setPushToTalkPressed(false);
      return undefined;
    }

    const shortcut =
      appState.preferences.pushToTalkShortcut || DEFAULT_PUSH_TO_TALK_SHORTCUT;
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
  }, [
    appState.preferences.pushToTalk,
    appState.preferences.pushToTalkShortcut,
  ]);

  useEffect(() => {
    setVoiceActivation((currentState) =>
      stepVoiceActivation(currentState, {
        inputLevel: currentState.inputLevel,
        captureEnabled: appState.audio.captureEnabled,
        selfMuted: appState.audio.selfMuted,
        pushToTalk: appState.preferences.pushToTalk,
        pushToTalkPressed,
        inputGain: appState.audio.inputGain,
        outputGain: appState.audio.outputGain,
      }),
    );
  }, [
    appState.audio.captureEnabled,
    appState.audio.inputGain,
    appState.audio.outputGain,
    appState.audio.selfMuted,
    appState.preferences.pushToTalk,
    pushToTalkPressed,
  ]);

  useEffect(() => {
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
      setMeteringError(
        "Microphone metering requires MediaDevices.getUserMedia.",
      );
      setVoiceActivation((currentState) =>
        stepVoiceActivation(currentState, {
          inputLevel: 0,
          captureEnabled: appState.audio.captureEnabled,
          selfMuted: appState.audio.selfMuted,
          pushToTalk: appState.preferences.pushToTalk,
          pushToTalkPressed: pushToTalkPressedRef.current,
          inputGain: appState.audio.inputGain,
          outputGain: appState.audio.outputGain,
        }),
      );
      return undefined;
    }

    if (!appState.audio.captureEnabled) {
      setMeteringError(null);
      setVoiceActivation((currentState) =>
        stepVoiceActivation(currentState, {
          inputLevel: 0,
          captureEnabled: false,
          selfMuted: appState.audio.selfMuted,
          pushToTalk: appState.preferences.pushToTalk,
          pushToTalkPressed: pushToTalkPressedRef.current,
          inputGain: appState.audio.inputGain,
          outputGain: appState.audio.outputGain,
        }),
      );
      return undefined;
    }

    const windowWithAudioContext = window as Window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextCtor =
      windowWithAudioContext.AudioContext ??
      windowWithAudioContext.webkitAudioContext;
    if (!AudioContextCtor) {
      setMeteringError("AudioContext is unavailable in this runtime.");
      return undefined;
    }

    let cancelled = false;
    let animationFrameId = 0;
    let mediaStream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let mediaRecorder: MediaRecorder | null = null;

    const stopMetering = () => {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
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
          audio: createInputDeviceConstraints(
            audioDevices.selectedInputId,
            dspPipeline.settings,
          ),
          video: false,
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
        voiceCaptureMimeTypeRef.current = null;
        setVoicePlaybackError(null);

        if (
          typeof MediaRecorder !== "undefined" &&
          window.voice?.send &&
          appState.connection.status === "connected"
        ) {
          try {
            const preferredMimeType = PREFERRED_VOICE_CAPTURE_MIME_TYPES.find(
              (mimeType) => MediaRecorder.isTypeSupported(mimeType),
            );
            mediaRecorder = preferredMimeType
              ? new MediaRecorder(mediaStream, {
                  mimeType: preferredMimeType,
                  audioBitsPerSecond: 64_000,
                })
              : new MediaRecorder(mediaStream);
            voiceCaptureMimeTypeRef.current =
              mediaRecorder.mimeType || preferredMimeType || null;
            if (!voiceCaptureMimeTypeRef.current) {
              setVoicePlaybackError(
                "Voice playback format is unavailable in this runtime.",
              );
            }
            mediaRecorder.addEventListener("dataavailable", (event) => {
              if (
                cancelled ||
                event.data.size === 0 ||
                !voiceActivationRef.current.isTransmitting ||
                !window.voice?.send
              ) {
                return;
              }

              void event.data
                .arrayBuffer()
                .then((buffer) => window.voice?.send(new Uint8Array(buffer)))
                .catch((error) => {
                  if (!cancelled) {
                    setVoicePlaybackError(
                      error instanceof Error
                        ? error.message
                        : "Unable to stream encoded voice.",
                    );
                  }
                });
            });
            mediaRecorder.addEventListener("error", () => {
              if (!cancelled) {
                setVoicePlaybackError("Voice capture encoding failed.");
              }
            });
            mediaRecorder.start(VOICE_CAPTURE_TIMESLICE_MS);
          } catch (error) {
            setVoicePlaybackError(
              error instanceof Error
                ? error.message
                : "Voice capture encoding is unavailable.",
            );
          }
        }

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
          const normalizedLevel = Math.min(
            1,
            rms * RMS_TO_LEVEL_SCALING_FACTOR,
          );

          setVoiceActivation((currentState) =>
            stepVoiceActivation(currentState, {
              inputLevel: normalizedLevel,
              captureEnabled: audioSettingsRef.current.captureEnabled,
              selfMuted: audioSettingsRef.current.selfMuted,
              pushToTalk: audioSettingsRef.current.pushToTalk,
              pushToTalkPressed: pushToTalkPressedRef.current,
              inputGain: audioSettingsRef.current.inputGain,
              outputGain: audioSettingsRef.current.outputGain,
            }),
          );
          animationFrameId = window.requestAnimationFrame(tick);
        };

        tick();
      } catch (error) {
        if (cancelled) {
          return;
        }

        setMeteringError(
          error instanceof Error
            ? error.message
            : "Microphone metering is unavailable.",
        );
        setVoiceActivation((currentState) =>
          stepVoiceActivation(currentState, {
            inputLevel: 0,
            captureEnabled: appState.audio.captureEnabled,
            selfMuted: appState.audio.selfMuted,
            pushToTalk: appState.preferences.pushToTalk,
            pushToTalkPressed: pushToTalkPressedRef.current,
            inputGain: appState.audio.inputGain,
            outputGain: appState.audio.outputGain,
          }),
        );
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
    appState.connection.status,
    appState.preferences.pushToTalk,
    audioDevices.selectedInputId,
    dspPipeline.settings,
    mediaDevices,
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
          setFormError(
            error instanceof Error
              ? error.message
              : "Unable to load desktop state.",
          );
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

  useEffect(() => {
    let active = true;

    const loadVoiceTransportStatus = async () => {
      if (!window.voice?.getStatus) {
        return;
      }

      try {
        const nextStatus = await window.voice.getStatus();
        if (active) {
          setVoiceTransportStatus(nextStatus);
        }
      } catch {
        if (active) {
          setVoiceTransportStatus(null);
        }
      }
    };

    void loadVoiceTransportStatus();
    const unsubscribe = window.voice?.onStatus?.((nextStatus) => {
      if (active) {
        setVoiceTransportStatus(nextStatus);
      }
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

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
      setSelfTestError(
        error instanceof Error ? error.message : "Unknown handshake failure",
      );
      setHandshakeState("error");
    }
  };

  const activeChannel = useMemo(
    () =>
      appState.channels.find(
        (channel) => channel.id === appState.activeChannelId,
      ) ?? null,
    [appState.activeChannelId, appState.channels],
  );
  const selfParticipant = useMemo(
    () =>
      appState.participants.find((participant) => participant.isSelf) ?? null,
    [appState.participants],
  );
  const selfParticipantChannel = useMemo(
    () =>
      selfParticipant
        ? (appState.channels.find(
            (channel) => channel.id === selfParticipant.channelId,
          ) ?? null)
        : null,
    [appState.channels, selfParticipant],
  );
  const activeParticipants = useMemo(
    () =>
      appState.participants.filter(
        (participant) => participant.channelId === appState.activeChannelId,
      ),
    [appState.activeChannelId, appState.participants],
  );
  const selectedParticipant = useMemo(
    () =>
      appState.participants.find(
        (participant) => participant.id === selectedParticipantId,
      ) ?? null,
    [appState.participants, selectedParticipantId],
  );
  const selectedParticipantChannel = useMemo(
    () =>
      selectedParticipant
        ? (appState.channels.find(
            (channel) => channel.id === selectedParticipant.channelId,
          ) ?? null)
        : null,
    [appState.channels, selectedParticipant],
  );
  const chatTarget = useMemo(
    () => getChatViewTarget(appState, selectedParticipantId),
    [appState, selectedParticipantId],
  );
  const activeMessages = useMemo(
    () => getChatMessagesForTarget(appState.messages, chatTarget),
    [appState.messages, chatTarget],
  );
  const activeChatTargetKey = useMemo(
    () => getChatTargetKey(chatTarget),
    [chatTarget],
  );
  const connectionError = formError ?? appState.connection.error;
  const connectionServerAddress =
    serverAddress.trim() || appState.connection.serverAddress;
  const connectionNickname = nickname.trim() || appState.connection.nickname;
  const connectionErrorKey = [
    connectionError,
    connectionServerAddress,
    connectionNickname,
  ].join("::");
  const isElectronBridgeAvailable = Boolean(window.app?.getState);
  const voiceActivationLabel = useMemo(
    () => getVoiceActivationLabel(voiceActivation.mode),
    [voiceActivation.mode],
  );
  const pushToTalkShortcutLabel = useMemo(
    () => formatPushToTalkShortcut(appState.preferences.pushToTalkShortcut),
    [appState.preferences.pushToTalkShortcut],
  );
  const quickActionTalkModeLabel = useMemo(
    () =>
      describeTalkMode({
        pushToTalk: appState.preferences.pushToTalk,
        pushToTalkPressed,
        shortcutLabel: pushToTalkShortcutLabel,
        voiceActivation,
      }),
    [
      appState.preferences.pushToTalk,
      pushToTalkPressed,
      pushToTalkShortcutLabel,
      voiceActivation,
    ],
  );
  const nextNavigableChannel = useMemo(
    () => findNextNavigableChannel(appState.channels, appState.activeChannelId),
    [appState.activeChannelId, appState.channels],
  );
  const localNicknames = appState.preferences.localNicknames;
  const shortcutBindings = appState.preferences.shortcutBindings;
  const favoriteServers = appState.preferences.favoriteServers;
  const isTalkingPopout = getCurrentView() === TALKING_POPOUT_VIEW;
  const talkingParticipants = useMemo(
    () =>
      [...appState.participants].sort((leftParticipant, rightParticipant) => {
        const statusOrderDifference =
          talkingParticipantOrder[leftParticipant.status] -
          talkingParticipantOrder[rightParticipant.status];
        if (statusOrderDifference !== 0) {
          return statusOrderDifference;
        }

        if (leftParticipant.isSelf !== rightParticipant.isSelf) {
          return leftParticipant.isSelf ? -1 : 1;
        }

        return getParticipantDisplayName(leftParticipant, localNicknames).localeCompare(
          getParticipantDisplayName(rightParticipant, localNicknames),
        );
      }),
    [appState.participants, localNicknames],
  );
  const themeVariables = useMemo(
    () =>
      importedTheme
        ? (buildBase16ThemeVariables(importedTheme) as CSSProperties)
        : undefined,
    [importedTheme],
  );
  const connectionRecovery = useMemo(() => {
    if (!connectionError) {
      return null;
    }

    return buildFailedConnectionRecovery(connectionError, {
      serverAddress: connectionServerAddress,
      nickname: connectionNickname,
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

  useEffect(() => {
    const nextReadMessageIds = activeMessages
      .filter((message) => !message.isSelf)
      .map((message) => message.id);

    setReadChatMessageIdsByTarget((currentState) => {
      const currentReadMessageIds = currentState[activeChatTargetKey] ?? [];
      if (
        currentReadMessageIds.length === nextReadMessageIds.length &&
        currentReadMessageIds.every(
          (messageId, index) => messageId === nextReadMessageIds[index],
        )
      ) {
        return currentState;
      }

      return {
        ...currentState,
        [activeChatTargetKey]: nextReadMessageIds,
      };
    });
  }, [activeChatTargetKey, activeMessages]);

  useEffect(() => {
    const nextReadMessageIds = activeMessages
      .filter((message) => !message.isSelf)
      .map((message) => message.id);

    setReadChatMessageIdsByTarget((currentState) => {
      const currentReadMessageIds = currentState[activeChatTargetKey] ?? [];
      if (
        currentReadMessageIds.length === nextReadMessageIds.length &&
        currentReadMessageIds.every(
          (messageId, index) => messageId === nextReadMessageIds[index],
        )
      ) {
        return currentState;
      }

      return {
        ...currentState,
        [activeChatTargetKey]: nextReadMessageIds,
      };
    });
  }, [activeChatTargetKey, activeMessages]);

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
          nickname: normalizedNickname,
        });
        setAppState(nextState);
        setChatDraft("");
      } catch (error) {
        setFormError(
          error instanceof Error ? error.message : "Unable to join voice.",
        );
      }
      return;
    }

    setFormError("Open the Electron desktop shell to connect to a live server.");
  };

  const disconnectFromServer = async () => {
    setFormError(null);
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
        error: null,
      },
      channels: [],
      activeChannelId: null,
      participants: [],
      messages: [],
      telemetry: {
        latencyMs: null,
        jitterMs: null,
        packetLoss: null,
      },
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
      activeChannelId: currentState.channels.some(
        (channel) => channel.id === channelId && channel.permissions.enter,
      )
        ? channelId
        : currentState.activeChannelId,
    }));
  };

  const joinChannel = async (channelId: string) => {
    if (window.app?.joinChannel) {
      const nextState = await window.app.joinChannel(channelId);
      setAppState(nextState);
      return;
    }

    updateLocalAppState((currentState) => {
      const nextChannel = currentState.channels.find(
        (channel) => channel.id === channelId,
      );
      if (!nextChannel || !nextChannel.permissions.enter) {
        return currentState;
      }

      const currentSelfParticipant = currentState.participants.find(
        (participant) => participant.isSelf,
      );
      const nextParticipants = currentState.participants.map((participant) =>
        currentSelfParticipant && participant.id === currentSelfParticipant.id
          ? { ...participant, channelId }
          : participant,
      );
      const participantIdsByChannel = new Map<string, string[]>();
      for (const participant of nextParticipants) {
        const participantIds = participantIdsByChannel.get(
          participant.channelId,
        );
        if (participantIds) {
          participantIds.push(participant.id);
        } else {
          participantIdsByChannel.set(participant.channelId, [participant.id]);
        }
      }

      return {
        ...currentState,
        activeChannelId: channelId,
        participants: nextParticipants,
        channels: currentState.channels.map((channel) => ({
          ...channel,
          participantIds: participantIdsByChannel.get(channel.id) ?? [],
        })),
      };
    });
  };

  const cycleChannel = async () => {
    if (!nextNavigableChannel) {
      return;
    }

    await selectChannel(nextNavigableChannel.id);
  };

  const updateShortcutBindings = useCallback(
    (nextShortcutBindings: AppClientShortcutBinding[]) => {
      void updatePreferences({ shortcutBindings: nextShortcutBindings });
    },
    [updatePreferences],
  );

  const addShortcutBinding = useCallback(() => {
    const nextTarget = findNextShortcutTarget(shortcutBindings);
    if (!nextTarget) {
      return;
    }

    updateShortcutBindings([
      ...shortcutBindings,
      getDefaultShortcutBinding(nextTarget),
    ]);
  }, [shortcutBindings, updateShortcutBindings]);

  const removeShortcutBinding = useCallback(
    (bindingTarget: AppClientShortcutBinding["target"]) => {
      updateShortcutBindings(
        shortcutBindings.filter((binding) => binding.target !== bindingTarget),
      );
    },
    [shortcutBindings, updateShortcutBindings],
  );

  const updateShortcutBindingTarget = useCallback(
    (
      bindingTarget: AppClientShortcutBinding["target"],
      nextTarget: AppClientShortcutBinding["target"],
    ) => {
      updateShortcutBindings(
        shortcutBindings.map((binding) =>
          binding.target === bindingTarget
            ? { ...binding, target: nextTarget }
            : binding,
        ),
      );
    },
    [shortcutBindings, updateShortcutBindings],
  );

  const updateShortcutBindingShortcut = useCallback(
    (
      bindingTarget: AppClientShortcutBinding["target"],
      nextShortcut: string,
    ) => {
      updateShortcutBindings(
        shortcutBindings.map((binding) =>
          binding.target === bindingTarget
            ? { ...binding, shortcut: nextShortcut }
            : binding,
        ),
      );
    },
    [shortcutBindings, updateShortcutBindings],
  );

  const handleShortcutAction = useCallback(
    async (target: AppClientShortcutBinding["target"]) => {
      switch (target) {
        case "toggleMute":
          await updateAudioSettings({ selfMuted: !appState.audio.selfMuted });
          break;
        case "selectSystemOutput":
          await updateAudioSettings({
            outputDeviceId: SYSTEM_DEFAULT_DEVICE_ID,
          });
          break;
        case "toggleLatencyDetails":
          await updatePreferences({
            showLatencyDetails: !appState.preferences.showLatencyDetails,
          });
          break;
        case "cycleChannel":
          await cycleChannel();
          break;
      }
    },
    [
      appState.audio.selfMuted,
      appState.preferences.showLatencyDetails,
      appState.preferences.pushToTalk,
      cycleChannel,
      updateAudioSettings,
      updatePreferences,
    ],
  );

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
          playbackError: voicePlaybackError,
          transportState: voiceTransportStatus?.state ?? "disconnected",
          averageRoundTripMs: voiceTransportStatus?.averageRoundTripMs ?? null,
          packetsSent: voiceTransportStatus?.packetsSent ?? null,
          packetsReceived: voiceTransportStatus?.packetsReceived ?? null,
          packetLoss: voiceTransportStatus?.packetLoss ?? null,
          availableInputDevices: audioDevices.inputs.length,
          availableOutputDevices: audioDevices.outputs.length,
          outputRoutingReady,
        },
      });

      if (result.canceled) {
        setDiagnosticsMessage("Diagnostics export canceled.");
        return;
      }

      setDiagnosticsMessage(`Diagnostics saved to ${result.filePath}.`);
    } catch (error) {
      setDiagnosticsError(
        error instanceof Error
          ? error.message
          : "Unable to export diagnostics.",
      );
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

      const matchedBinding = shortcutBindings.find(
        (binding) =>
          (reservedShortcut === null ||
            binding.shortcut !== reservedShortcut) &&
          matchesPushToTalkShortcut(binding.shortcut, event),
      );

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
    shortcutBindings,
  ]);
  useEffect(() => {
    if (!activeDockInteraction) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const deltaX = event.clientX - activeDockInteraction.startClientX;
      const deltaY = event.clientY - activeDockInteraction.startClientY;

      setDockPanels((currentPanels) => ({
        ...currentPanels,
        [activeDockInteraction.panelId]: {
          ...currentPanels[activeDockInteraction.panelId],
          offsetX:
            activeDockInteraction.mode === "move"
              ? activeDockInteraction.startOffsetX + deltaX
              : currentPanels[activeDockInteraction.panelId].offsetX,
          offsetY:
            activeDockInteraction.mode === "move"
              ? activeDockInteraction.startOffsetY + deltaY
              : currentPanels[activeDockInteraction.panelId].offsetY,
          width:
            activeDockInteraction.mode === "resize"
              ? Math.max(
                  DOCK_PANEL_MIN_WIDTH,
                  activeDockInteraction.startWidth + deltaX,
                )
              : currentPanels[activeDockInteraction.panelId].width,
          height:
            activeDockInteraction.mode === "resize"
              ? Math.max(
                  DOCK_PANEL_MIN_HEIGHT,
                  activeDockInteraction.startHeight + deltaY,
                )
              : currentPanels[activeDockInteraction.panelId].height,
        },
      }));
    };
    const handlePointerUp = () => {
      setActiveDockInteraction(null);
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor =
      activeDockInteraction.mode === "move" ? "grabbing" : "nwse-resize";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeDockInteraction]);

  const openDiagnostics = () => {
    if (!appState.preferences.showLatencyDetails) {
      void updatePreferences({ showLatencyDetails: true });
    }

    window.setTimeout(() => {
      diagnosticsSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  };

  const openTalkingPopout = useCallback(async () => {
    setThemeError(null);
    if (window.app?.openTalkingPopout) {
      await window.app.openTalkingPopout();
      return;
    }

    window.open(
      `${window.location.pathname}?view=${TALKING_POPOUT_VIEW}`,
      "mumble-talking-popout",
      "popup=1,width=320,height=520,resizable=yes",
    );
  }, []);

  const importBase16Theme = useCallback(() => {
    const rawTheme = window.prompt("Paste a dark Base16 YAML or JSON theme.");
    if (rawTheme === null) {
      return;
    }

    try {
      const parsedTheme = parseBase16Theme(rawTheme);
      setImportedTheme(parsedTheme);
      storeBase16Theme(window.localStorage, parsedTheme);
      setThemeMessage(
        `${parsedTheme.scheme}${parsedTheme.author ? ` · ${parsedTheme.author}` : ""}`,
      );
      setThemeError(null);
    } catch (error) {
      setThemeError(
        error instanceof Error ? error.message : "Unable to import Base16 theme.",
      );
      setThemeMessage(null);
    }
  }, []);

  const resetImportedTheme = useCallback(() => {
    clearStoredBase16Theme(window.localStorage);
    setImportedTheme(null);
    setThemeError(null);
    setThemeMessage("Default dark theme restored.");
  }, []);
  const bringDockPanelToFront = useCallback((panelId: DockPanelId) => {
    setDockPanels((currentPanels) => {
      const highestZIndex = Math.max(
        ...Object.values(currentPanels).map((panel) => panel.zIndex),
      );
      if (currentPanels[panelId].zIndex === highestZIndex) {
        return currentPanels;
      }

      return {
        ...currentPanels,
        [panelId]: {
          ...currentPanels[panelId],
          zIndex: highestZIndex + 1,
        },
      };
    });
  }, []);
  const closeDockPanel = useCallback((panelId: DockPanelId) => {
    setDockPanels((currentPanels) => ({
      ...currentPanels,
      [panelId]: {
        ...currentPanels[panelId],
        isClosed: true,
      },
    }));
  }, []);
  const restoreDockPanel = useCallback((panelId: DockPanelId) => {
    bringDockPanelToFront(panelId);
    setDockPanels((currentPanels) => ({
      ...currentPanels,
      [panelId]: {
        ...currentPanels[panelId],
        isClosed: false,
        isMinimized: false,
      },
    }));
  }, [bringDockPanelToFront]);
  const toggleDockPanelMinimized = useCallback((panelId: DockPanelId) => {
    bringDockPanelToFront(panelId);
    setDockPanels((currentPanels) => ({
      ...currentPanels,
      [panelId]: {
        ...currentPanels[panelId],
        isMinimized: !currentPanels[panelId].isMinimized,
      },
    }));
  }, [bringDockPanelToFront]);
  const startDockPanelInteraction = useCallback(
    (
      panelId: DockPanelId,
      mode: DockPanelInteraction["mode"],
      event: ReactPointerEvent<HTMLElement>,
    ) => {
      if (
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      const panelElement = dockPanelRefs.current[panelId];
      if (!panelElement) {
        return;
      }

      const panel = dockPanels[panelId];
      bringDockPanelToFront(panelId);
      setActiveDockInteraction({
        panelId,
        mode,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffsetX: panel.offsetX,
        startOffsetY: panel.offsetY,
        startWidth: panel.width ?? panelElement.getBoundingClientRect().width,
        startHeight: panel.height,
      });
      event.preventDefault();
    },
    [bringDockPanelToFront, dockPanels],
  );

  const sendChatMessage = async () => {
    if (!chatDraft.trim()) {
      setFormError("Enter a message before sending.");
      return;
    }

    setFormError(null);

    const chatRequest =
      chatTarget.type === "participant"
        ? { body: chatDraft, participantId: chatTarget.participantId }
        : { body: chatDraft, channelId: chatTarget.channelId };

    if (window.app?.sendChatMessage) {
      try {
        const nextState = await window.app.sendChatMessage(chatRequest);
        setAppState(nextState);
        setChatDraft("");
      } catch (error) {
        setFormError(
          error instanceof Error ? error.message : "Unable to send chat.",
        );
      }
      return;
    }

    try {
      updateLocalAppState((currentState) =>
        appendLocalChatMessageState(currentState, chatRequest),
      );
      setChatDraft("");
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Unable to send chat.",
      );
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
        participantNicknameDraft,
      ),
    });
  }, [
    localNicknames,
    participantNicknameDraft,
    selectedParticipant,
    updatePreferences,
  ]);

  const applyPreset = (settings: (typeof audioPresets)[number]["settings"]) => {
    const normalizedSettings = persistDspSettings(settings);
    setDspPipelineState(createDspPipeline(normalizedSettings));
    void updatePreferences({ voiceProcessing: normalizedSettings });
  };
  const trimmedServerAddress = serverAddress.trim();
  const selectedParticipantDisplayName = selectedParticipant
    ? getParticipantDisplayName(selectedParticipant, localNicknames)
    : null;
  const chatSubtitle =
    chatTarget.type === "participant" && selectedParticipantDisplayName
      ? `Direct messages with ${selectedParticipantDisplayName}`
      : activeChannel
        ? `Messages in ${activeChannel.name}`
        : "Basic room chat";
  const chatPlaceholder =
    chatTarget.type === "participant" && selectedParticipantDisplayName
      ? `Message ${selectedParticipantDisplayName} privately`
      : activeChannel
        ? `Message ${activeChannel.name}`
        : "Message the active room";
  const canSendChat =
    appState.connection.status === "connected" &&
    (chatTarget.type === "participant" || chatTarget.channelId !== null);
  const channelsSubtitle = activeChannel
    ? `${activeChannel.name}${selfParticipantChannel ? ` · in ${selfParticipantChannel.name}` : ""}${!activeChannel.permissions.enter ? " · no entry" : ""}`
    : "Join a server to load rooms";
  const participantsSubtitle = activeChannel
    ? `${activeParticipants.length} shown${selfParticipantChannel && selfParticipantChannel.id !== activeChannel.id ? ` · you are in ${selfParticipantChannel.name}` : ""}`
    : "Live session roster";
  const participantsByChannel = useMemo(() => {
    const groupedParticipants = new Map<string, AppClientParticipant[]>();

    for (const participant of appState.participants) {
      const channelParticipants =
        groupedParticipants.get(participant.channelId) ?? [];
      channelParticipants.push(participant);
      groupedParticipants.set(participant.channelId, channelParticipants);
    }

    for (const channelParticipants of groupedParticipants.values()) {
      channelParticipants.sort((leftParticipant, rightParticipant) => {
        const statusOrderDifference =
          talkingParticipantOrder[leftParticipant.status] -
          talkingParticipantOrder[rightParticipant.status];
        if (statusOrderDifference !== 0) {
          return statusOrderDifference;
        }

        if (leftParticipant.isSelf !== rightParticipant.isSelf) {
          return leftParticipant.isSelf ? -1 : 1;
        }

        return getParticipantDisplayName(
          leftParticipant,
          localNicknames,
        ).localeCompare(getParticipantDisplayName(rightParticipant, localNicknames));
      });
    }

    return groupedParticipants;
  }, [appState.participants, localNicknames]);
  const activityLogMessages = useMemo(
    () => [...appState.messages].slice(-MAX_ACTIVITY_LOG_MESSAGES).reverse(),
    [appState.messages],
  );
  const compactChatLogMessages = useMemo(
    () => getCompactChatLogMessages(activeMessages),
    [activeMessages],
  );
  const minimalViewNote =
    appState.connection.status === "connected"
      ? `Connected to ${appState.connection.serverAddress || serverAddress || "server"} as ${appState.connection.nickname || nickname || "guest"} · ${participantsSubtitle.toLowerCase()}`
      : "You are currently in minimal view but not connected to a server. Use the toolbar to connect or open the talking popout.";
  const closedDockPanels = (Object.keys(dockPanels) as DockPanelId[]).filter(
    (panelId) => dockPanels[panelId].isClosed,
  );
  const renderDockPanel = (
    panelId: DockPanelId,
    subtitle: string,
    delayClass: string,
    content: JSX.Element,
  ) => {
    const panel = dockPanels[panelId];
    if (panel.isClosed) {
      return null;
    }

    const title = DOCK_PANEL_TITLES[panelId];

    return (
      <Box
        key={panelId}
        ref={(element) => {
          dockPanelRefs.current[panelId] = element;
        }}
        className={`legacy-dock-panel-shell${panel.isMinimized ? " is-minimized" : ""}`}
        style={{
          transform: `translate(${panel.offsetX}px, ${panel.offsetY}px)`,
          zIndex: panel.zIndex,
          width: panel.width ? `${panel.width}px` : undefined,
          height: `${panel.isMinimized ? DOCK_PANEL_MINIMIZED_HEIGHT : panel.height}px`,
        }}
        onPointerDown={() => {
          bringDockPanelToFront(panelId);
        }}
      >
        <Card className={`section-card compact-panel legacy-dock-panel fade-in ${delayClass}`}>
          <Flex
            className="legacy-dock-panel-header"
            align="center"
            justify="between"
            gap="2"
            onPointerDown={(event) => {
              startDockPanelInteraction(panelId, "move", event);
            }}
          >
            <Flex direction="column" gap="1">
              <Text size="2" weight="bold">
                {title}
              </Text>
              <Text size="1" color="gray">
                {subtitle}
              </Text>
            </Flex>
            <Flex align="center" gap="1" className="legacy-dock-panel-controls">
              <IconButton
                size="1"
                variant="ghost"
                type="button"
                aria-label={
                  panel.isMinimized ? `Restore ${title}` : `Minimize ${title}`
                }
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleDockPanelMinimized(panelId);
                }}
              >
                {panel.isMinimized ? <OpenInNewWindowIcon /> : <MinusIcon />}
              </IconButton>
              <IconButton
                size="1"
                variant="ghost"
                color="ruby"
                type="button"
                aria-label={`Close ${title}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  closeDockPanel(panelId);
                }}
              >
                <Cross2Icon />
              </IconButton>
            </Flex>
          </Flex>
          {!panel.isMinimized ? (
            <Flex direction="column" gap="2" className="legacy-dock-panel-body">
              {content}
            </Flex>
          ) : null}
          {!panel.isMinimized ? (
            <button
              type="button"
              className="legacy-dock-panel-resize-handle"
              aria-label={`Resize ${title}`}
              onPointerDown={(event) => {
                startDockPanelInteraction(panelId, "resize", event);
              }}
            />
          ) : null}
        </Card>
      </Box>
    );
  };

  if (isTalkingPopout) {
    return (
      <Theme
        appearance="dark"
        accentColor="cyan"
        grayColor="slate"
        radius="large"
        scaling="95%"
      >
        <Box
          className="subtle-grid talking-popout-shell"
          style={{ ...themeVariables, minHeight: "100vh" }}
        >
          <main className="talking-popout-main">
            <Flex direction="column" gap="3">
              <Flex align="center" justify="between" gap="3">
                <Flex direction="column" gap="1">
                  <Text size="1" color="gray">
                    Talking popout
                  </Text>
                  <Heading size="4">
                    {appState.connection.serverAddress || "Mumble session"}
                  </Heading>
                  <Text size="1" color="gray">
                    {talkingParticipants.length} participant
                    {talkingParticipants.length === 1 ? "" : "s"}
                  </Text>
                </Flex>
                <Button
                  size="1"
                  variant="soft"
                  onClick={() => {
                    window.close();
                  }}
                >
                  Close
                </Button>
              </Flex>
              {talkingParticipants.length > 0 ? (
                <Flex direction="column" gap="2">
                  {talkingParticipants.map((participant) => {
                    const participantChannel =
                      appState.channels.find(
                        (channel) => channel.id === participant.channelId,
                      ) ?? null;
                    return (
                      <Card
                        key={participant.id}
                        className={`section-card talking-popout-card${participant.status === "live" ? " is-speaking" : ""}`}
                      >
                        <Flex align="center" justify="between" gap="3">
                          <Flex align="center" gap="3">
                            <Box className="participant-avatar compact-avatar">
                              <PersonIcon />
                            </Box>
                            <Box>
                              <Text size="2" weight="medium">
                                {getParticipantDisplayName(
                                  participant,
                                  localNicknames,
                                )}
                              </Text>
                              <Text size="1" color="gray">
                                {participantChannel?.name ?? "No channel"}
                              </Text>
                            </Box>
                          </Flex>
                          <StatusChip
                            status={participant.status}
                            label={getParticipantStatusLabel(participant)}
                          />
                        </Flex>
                      </Card>
                    );
                  })}
                </Flex>
              ) : (
                <Card className="section-card talking-popout-card">
                  <Text size="2" color="gray">
                    Nobody is connected yet. Once the live roster arrives, the
                    active speakers will show up here.
                  </Text>
                </Card>
              )}
            </Flex>
          </main>
        </Box>
      </Theme>
    );
  }

  return (
    <Theme
      appearance="dark"
      accentColor="cyan"
      grayColor="slate"
      radius="large"
      scaling="100%"
    >
      <Box
        className="subtle-grid app-shell"
        style={{ ...themeVariables, minHeight: "100vh" }}
      >
        <main className="app-main legacy-main-window">
          <audio ref={outputPreviewRef} preload="none" />
          <Flex direction="column" gap="2" className="legacy-window-frame">
            <Flex className="legacy-menu-bar" align="center" justify="between" gap="3" wrap="wrap">
              <Flex align="center" gap="1" wrap="wrap">
                <Button size="1" variant="ghost" className="legacy-menu-button">
                  Server
                </Button>
                <Button size="1" variant="ghost" className="legacy-menu-button">
                  Self
                </Button>
                <Button size="1" variant="ghost" className="legacy-menu-button">
                  Configure
                </Button>
                <Button size="1" variant="ghost" className="legacy-menu-button">
                  Help
                </Button>
              </Flex>
              <Flex align="center" gap="1" wrap="wrap">
                <StatusChip
                  status={
                    appState.connection.status === "connected"
                      ? "live"
                      : appState.connection.status === "error"
                        ? "muted"
                        : "idle"
                  }
                  label={statusCopy[appState.connection.status]}
                />
                <StatusChip status="idle" label={`Running on ${platformLabel}`} />
                <StatusChip
                  status={
                    voiceActivation.isTransmitting
                      ? "live"
                      : voiceActivation.mode === "muted"
                        ? "muted"
                        : "idle"
                  }
                  label={voiceActivationLabel}
                />
              </Flex>
            </Flex>

            <Flex className="legacy-toolbar" align="center" gap="1" wrap="wrap">
              <Button
                size="1"
                variant="soft"
                onClick={() => {
                  void connectToServer();
                }}
                disabled={isConnectionBusy(appState.connection.status)}
              >
                <GlobeIcon />
                Connect
              </Button>
              <Button
                size="1"
                variant="soft"
                onClick={() => {
                  void disconnectFromServer();
                }}
                disabled={
                  appState.connection.status === "disconnected" &&
                  !appState.connection.error
                }
              >
                Disconnect
              </Button>
              <Button
                size="1"
                variant="soft"
                onClick={saveFavoriteServer}
                disabled={
                  appState.connection.status === "connecting" ||
                  trimmedServerAddress.length === 0
                }
              >
                Add favorite
              </Button>
              <Box className="legacy-toolbar-separator" />
              <Button
                size="1"
                variant="soft"
                onClick={() => {
                  void cycleChannel();
                }}
                disabled={!nextNavigableChannel}
                title={
                  nextNavigableChannel
                    ? `Move to ${nextNavigableChannel.name}`
                    : "Connect to browse rooms"
                }
              >
                Back
              </Button>
              <Box className="legacy-toolbar-separator" />
              <Button
                size="1"
                variant={appState.audio.selfMuted ? "solid" : "soft"}
                color={appState.audio.selfMuted ? "red" : undefined}
                onClick={() => {
                  void updateAudioSettings({
                    selfMuted: !appState.audio.selfMuted,
                  });
                }}
                title={quickActionTalkModeLabel}
              >
                <SpeakerOffIcon />
                Mute
              </Button>
              <Button
                size="1"
                variant={appState.preferences.pushToTalk ? "solid" : "soft"}
                color={appState.preferences.pushToTalk ? "cyan" : undefined}
                onClick={() => {
                  void updatePreferences({
                    pushToTalk: !appState.preferences.pushToTalk,
                  });
                }}
                title={pushToTalkShortcutLabel}
              >
                <PersonIcon />
                PTT
              </Button>
              <Button
                size="1"
                variant="soft"
                onClick={() => {
                  void openTalkingPopout();
                }}
              >
                <OpenInNewWindowIcon />
                Popout
              </Button>
              <Box className="legacy-toolbar-separator" />
              <Button size="1" variant="soft" onClick={importBase16Theme}>
                Import theme
              </Button>
              {importedTheme ? (
                <Button size="1" variant="ghost" onClick={resetImportedTheme}>
                  Reset theme
                </Button>
              ) : null}
              <Button size="1" variant="soft" onClick={openDiagnostics}>
                <LightningBoltIcon />
                Diagnostics
              </Button>
            </Flex>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void connectToServer();
              }}
            >
              <Flex className="legacy-session-strip" align="center" justify="between" gap="2" wrap="wrap">
                <Flex align="center" gap="2" wrap="wrap">
                  <Text size="1" color="gray">
                    {appState.connection.serverAddress || trimmedServerAddress || "Not connected"}
                  </Text>
                  <Badge size="1" variant="soft">
                    {appState.connection.nickname || nickname || "Guest"}
                  </Badge>
                  {favoriteServers.length > 0 || appState.recentServers.length > 0 ? (
                    <Text size="1" color="gray">
                      {favoriteServers.length + appState.recentServers.length} saved
                    </Text>
                  ) : null}
                </Flex>
                <Button
                  size="1"
                  variant="soft"
                  type="button"
                  onClick={() => {
                    setIsConnectionPanelExpanded((currentValue) => !currentValue);
                  }}
                >
                  {isConnectionPanelExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
                  {isConnectionPanelExpanded ? "Hide connection" : "Edit connection"}
                </Button>
              </Flex>
              {isConnectionPanelExpanded ? (
                <Flex className="legacy-connect-strip" gap="2" wrap="wrap" align="center">
                  <TextField.Root
                    size="1"
                    className="legacy-connect-field"
                    placeholder="Server address"
                    value={serverAddress}
                    onChange={(event) => {
                      setServerAddress(event.target.value);
                    }}
                    disabled={isConnectionBusy(appState.connection.status)}
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
                    size="1"
                    className="legacy-nickname-field"
                    placeholder="Nickname"
                    value={nickname}
                    onChange={(event) => {
                      setNickname(event.target.value);
                    }}
                    disabled={isConnectionBusy(appState.connection.status)}
                  >
                    <TextField.Slot>
                      <ChatBubbleIcon />
                    </TextField.Slot>
                  </TextField.Root>
                  <Button size="1" type="submit" disabled={isConnectionBusy(appState.connection.status)}>
                    {appState.connection.status === "authenticating"
                      ? "Authenticating…"
                      : appState.connection.status === "connecting"
                        ? "Joining…"
                        : "Join"}
                  </Button>
                  <Button
                    size="1"
                    variant="outline"
                    type="button"
                    onClick={() => {
                      void rememberServer(serverAddress);
                    }}
                    disabled={
                      isConnectionBusy(appState.connection.status) ||
                      trimmedServerAddress.length === 0
                    }
                  >
                    Save
                  </Button>
                </Flex>
              ) : null}
            </form>

            {isConnectionPanelExpanded &&
            (favoriteServers.length > 0 || appState.recentServers.length > 0) ? (
              <Flex className="legacy-server-strip" gap="2" wrap="wrap" align="center">
                {favoriteServers.length > 0 ? (
                  <>
                    <Text size="1" color="gray">
                      Favorites
                    </Text>
                    {favoriteServers.map((favoriteServer) => (
                      <Flex key={favoriteServer.address} gap="1" align="center">
                        <Button
                          size="1"
                          variant={
                            trimmedServerAddress === favoriteServer.address
                              ? "solid"
                              : "soft"
                          }
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
                  </>
                ) : null}
                {appState.recentServers.length > 0 ? (
                  <>
                    <Text size="1" color="gray">
                      Recent
                    </Text>
                    {appState.recentServers.map((recentServer) => (
                      <Button
                        key={recentServer}
                        size="1"
                        variant={
                          trimmedServerAddress === recentServer ? "solid" : "soft"
                        }
                        type="button"
                        onClick={() => {
                          loadRecentServer(recentServer);
                        }}
                        disabled={isConnectionBusy(appState.connection.status)}
                      >
                        {recentServer}
                      </Button>
                    ))}
                  </>
                ) : null}
              </Flex>
            ) : null}

            {connectionError &&
            connectionRecovery &&
            dismissedConnectionErrorKey !== connectionErrorKey ? (
              <Card className="section-card legacy-inline-alert">
                <Flex direction="column" gap="2">
                  <Text size="2" color="ruby" weight="bold">
                    {connectionError}
                  </Text>
                  <Flex direction="column" gap="1">
                    {connectionRecovery.steps.map((step) => (
                      <Text key={step} size="1" color="gray">
                        • {step}
                      </Text>
                    ))}
                  </Flex>
                  <Flex gap="2" wrap="wrap">
                    <Button
                      size="1"
                      onClick={() => {
                        void connectToServer();
                      }}
                      disabled={isConnectionBusy(appState.connection.status)}
                    >
                      Retry
                    </Button>
                    <Button size="1" variant="soft" onClick={openDiagnostics}>
                      Diagnostics
                    </Button>
                    <Button
                      size="1"
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

            {themeMessage ? (
              <Text size="1" color="gray">
                Theme: {themeMessage}
              </Text>
            ) : null}
            {themeError ? (
              <Text size="1" color="ruby">
                {themeError}
              </Text>
            ) : null}
            {isLoadingAppState ? (
              <Text size="1" color="gray">
                Loading saved desktop state…
              </Text>
            ) : null}
            {!isElectronBridgeAvailable ? (
              <Text size="1" color="gray">
                Open the Electron shell to persist session state and preferences.
              </Text>
            ) : null}

            <Card className="section-card compact-panel legacy-tree-panel fade-in">
              <Flex direction="column" gap="2">
                <SectionHeader
                  title={appState.connection.serverAddress || "Main Window"}
                  subtitle={channelsSubtitle}
                  action={
                    <Flex gap="1" wrap="wrap">
                      {handshakeState === "success" ? (
                        <Badge size="1" color="green" variant="soft">
                          Secure
                        </Badge>
                      ) : null}
                      {appState.telemetry.jitterMs !== null ? (
                        <Badge size="1" variant="soft">
                          {appState.telemetry.jitterMs} ms jitter
                        </Badge>
                      ) : null}
                    </Flex>
                  }
                />
                {appState.channels.length > 0 ? (
                  <Flex direction="column" gap="1">
                    {appState.channels.map((channel) => {
                      const participantCount = channel.participantIds.length;
                      const isActive = channel.id === appState.activeChannelId;
                      const isJoined = channel.id === selfParticipant?.channelId;
                      const unreadCount = getUnreadCountForTarget(
                        appState.messages,
                        { type: "channel", channelId: channel.id },
                        readChatMessageIdsByTarget[
                          getChatTargetKey({
                            type: "channel",
                            channelId: channel.id,
                          })
                        ],
                      );

                      return (
                        <Box key={channel.id}>
                          <Flex gap="1" align="stretch">
                            <Button
                              className={`channel-row-button${isActive ? " is-active" : ""}`}
                              variant={isActive ? "solid" : "soft"}
                              color={isActive ? "cyan" : undefined}
                              style={{
                                flex: 1,
                                justifyContent: "space-between",
                                paddingLeft: `${BASE_CHANNEL_PADDING + channel.depth * CHANNEL_INDENT_PER_LEVEL}px`,
                              }}
                              onClick={() => {
                                void selectChannel(channel.id);
                              }}
                              disabled={!channel.permissions.enter}
                              title={
                                !channel.permissions.enter
                                  ? `${channel.name} · locked`
                                  : channel.permissions.speak
                                    ? `${channel.name} · join room`
                                    : `${channel.name} · listen only`
                              }
                            >
                              <Flex align="center" justify="between" width="100%" gap="2">
                                <Flex align="center" gap="2" wrap="wrap">
                                  <span>{channel.name}</span>
                                  {isJoined ? (
                                    <Badge size="1" color="green" variant="soft">
                                      Joined
                                    </Badge>
                                  ) : null}
                                  {!channel.permissions.enter ? (
                                    <Text as="span" size="1" color="gray">
                                      Locked
                                    </Text>
                                  ) : null}
                                  {channel.permissions.enter &&
                                  !channel.permissions.speak ? (
                                    <Text as="span" size="1" color="gray">
                                      Listen
                                    </Text>
                                  ) : null}
                                  {!isActive && unreadCount > 0 ? (
                                    <Badge size="1" color="orange" variant="soft">
                                      {unreadCount}
                                    </Badge>
                                  ) : null}
                                </Flex>
                                <span>{participantCount}</span>
                              </Flex>
                            </Button>
                            {channel.permissions.enter && !isJoined ? (
                              <Button
                                size="1"
                                variant="soft"
                                onClick={() => {
                                  void joinChannel(channel.id);
                                }}
                                title={`Join ${channel.name}`}
                              >
                                Join
                              </Button>
                            ) : null}
                          </Flex>
                          {(participantsByChannel.get(channel.id) ?? []).map((participant) => {
                            const unreadCount = participant.isSelf
                              ? 0
                              : getUnreadCountForTarget(
                                  appState.messages,
                                  {
                                    type: "participant",
                                    participantId: participant.id,
                                  },
                                  readChatMessageIdsByTarget[
                                    getChatTargetKey({
                                      type: "participant",
                                      participantId: participant.id,
                                    })
                                  ],
                                );

                            return (
                              <Button
                                key={participant.id}
                                className="participant-row-button legacy-tree-participant"
                                type="button"
                                variant={
                                  selectedParticipantId === participant.id
                                    ? "soft"
                                    : "ghost"
                                }
                                onClick={() => {
                                  setSelectedParticipantId(participant.id);
                                  setFormError(null);
                                }}
                                style={{
                                  justifyContent: "space-between",
                                  width: "100%",
                                  marginLeft: `${BASE_CHANNEL_PADDING + channel.depth * CHANNEL_INDENT_PER_LEVEL + PARTICIPANT_INDENT_OFFSET}px`,
                                }}
                                title={selectedParticipantChannel?.name}
                              >
                                <Flex align="center" justify="between" width="100%" gap="2">
                                  <Flex align="center" gap="2" wrap="wrap">
                                    <Box className="participant-avatar compact-avatar legacy-inline-avatar">
                                      <PersonIcon />
                                    </Box>
                                    <Text size="2">
                                      {getParticipantDisplayName(
                                        participant,
                                        localNicknames,
                                      )}
                                    </Text>
                                    {getParticipantStateLabels(participant).map((label) => (
                                      <Badge
                                        key={`${participant.id}-${label}`}
                                        size="1"
                                        variant="soft"
                                        color="gray"
                                      >
                                        {label}
                                      </Badge>
                                    ))}
                                    {!participant.isSelf && unreadCount > 0 ? (
                                      <Badge size="1" color="orange" variant="soft">
                                        {unreadCount}
                                      </Badge>
                                    ) : null}
                                  </Flex>
                                  <Text size="1" color="gray">
                                    {getParticipantStatusLabel(participant)}
                                  </Text>
                                </Flex>
                              </Button>
                            );
                          })}
                        </Box>
                      );
                    })}
                  </Flex>
                ) : (
                  <Text size="2" color="gray">
                    {isConnectionBusy(appState.connection.status)
                      ? "Loading channel tree…"
                      : "No rooms yet. Connect to a server to load the current channel list."}
                  </Text>
                )}
              </Flex>
            </Card>

            <Grid columns={{ initial: "1", md: "3" }} gap="2" className="legacy-dock-grid">
              {renderDockPanel(
                "log",
                "Activity log",
                "delay-1",
                <>
                  <Flex align="center" justify="between" gap="2" wrap="wrap">
                    <Text size="1" color="gray">
                      Recent activity
                    </Text>
                    <Button
                      size="1"
                      variant="ghost"
                      type="button"
                      onClick={() => {
                        setIsActivityLogExpanded((currentValue) => !currentValue);
                      }}
                    >
                      {isActivityLogExpanded ? "Hide" : "Show"}
                    </Button>
                  </Flex>
                  {isActivityLogExpanded ? (
                    activityLogMessages.length > 0 ? (
                      <Flex direction="column" gap="1" className="legacy-log-list">
                        {activityLogMessages.map((message) => (
                          <Box key={message.id} className="legacy-log-entry">
                            <Flex align="center" justify="between" gap="2" wrap="wrap">
                              <Text size="1" weight="bold">
                                {message.author}
                              </Text>
                              <Text size="1" color="gray">
                                {formatChatTimestamp(message.sentAt)}
                              </Text>
                            </Flex>
                            <Text
                              size="1"
                              color={message.severity === "error" ? "ruby" : "gray"}
                            >
                              {message.body}
                            </Text>
                          </Box>
                        ))}
                      </Flex>
                    ) : (
                      <Text size="1" color="gray">
                        Recent activity, connection notices, and chat will appear here.
                      </Text>
                    )
                  ) : null}
                </>,
              )}

              {renderDockPanel(
                "chat",
                chatSubtitle,
                "delay-2",
                <>
                  <Flex align="center" justify="between" gap="2" wrap="wrap">
                    <Text size="1" color="gray">
                      Chat log
                    </Text>
                    <Button
                      size="1"
                      variant="ghost"
                      type="button"
                      onClick={() => {
                        setIsChatLogExpanded((currentValue) => !currentValue);
                      }}
                    >
                      {isChatLogExpanded ? "Hide" : "Show"}
                    </Button>
                  </Flex>
                  {isChatLogExpanded ? (
                    compactChatLogMessages.length > 0 ? (
                      <Flex
                        direction="column"
                        gap="1"
                        className="legacy-log-list legacy-chat-log-list"
                      >
                        {compactChatLogMessages.map((message) => (
                          <Box key={message.id} className="legacy-log-entry">
                            <Flex align="center" justify="between" gap="2" wrap="wrap">
                              <Text size="1" weight="bold">
                                {message.author}
                              </Text>
                              <Text size="1" color="gray">
                                {formatChatTimestamp(message.sentAt)}
                              </Text>
                            </Flex>
                            <Text
                              size="1"
                              color={message.severity === "error" ? "ruby" : "gray"}
                            >
                              {message.body}
                            </Text>
                          </Box>
                        ))}
                      </Flex>
                    ) : (
                      <Text size="1" color="gray">
                        No chat messages yet for this room or direct message.
                      </Text>
                    )
                  ) : null}
                  {selectedParticipant ? (
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">
                        Selected: {selectedParticipantDisplayName}
                        {selectedParticipantChannel
                          ? ` · ${selectedParticipantChannel.name}`
                          : ""}
                      </Text>
                      <TextField.Root
                        size="1"
                        value={participantNicknameDraft}
                        placeholder="Local nickname"
                        onChange={(event) => {
                          setParticipantNicknameDraft(event.target.value);
                        }}
                      >
                        <TextField.Slot>
                          <PersonIcon />
                        </TextField.Slot>
                      </TextField.Root>
                      <Flex gap="1" wrap="wrap">
                        <Button
                          size="1"
                          type="button"
                          onClick={() => {
                            void saveLocalNickname();
                          }}
                        >
                          Save alias
                        </Button>
                        <Button
                          size="1"
                          variant="soft"
                          type="button"
                          onClick={() => {
                            setParticipantNicknameDraft("");
                            void updatePreferences({
                              localNicknames: withParticipantLocalNickname(
                                localNicknames,
                                selectedParticipant.id,
                                "",
                              ),
                            });
                          }}
                          disabled={!localNicknames[selectedParticipant.id]}
                        >
                          Clear alias
                        </Button>
                      </Flex>
                    </Flex>
                  ) : null}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendChatMessage();
                    }}
                  >
                    <Flex direction="column" gap="2">
                      <TextField.Root
                        size="2"
                        placeholder={chatPlaceholder}
                        value={chatDraft}
                        onChange={(event) => {
                          setChatDraft(event.target.value);
                        }}
                        disabled={!canSendChat}
                      >
                        <TextField.Slot>
                          <ChatBubbleIcon />
                        </TextField.Slot>
                      </TextField.Root>
                      <Flex align="center" justify="between" gap="2" wrap="wrap">
                        <Text size="1" color="gray">
                          {chatTarget.type === "participant" &&
                          selectedParticipantDisplayName
                            ? `Replying to ${selectedParticipantDisplayName}`
                            : activeChannel
                              ? `Sending to ${activeChannel.name}`
                              : "Select a room or user to chat"}
                        </Text>
                        <Button size="1" type="submit" disabled={!canSendChat}>
                          Send
                        </Button>
                      </Flex>
                    </Flex>
                  </form>
                </>,
              )}

              {renderDockPanel(
                "self",
                "Voice controls, transport, and preferences",
                "delay-3",
                <>
                  <div ref={diagnosticsSectionRef}>
                    <Flex direction="column" gap="2">
                      <Flex align="center" justify="between" gap="2" wrap="wrap">
                        <Text size="1" color="gray">
                          Toggle diagnostics details
                        </Text>
                        <Button
                          size="1"
                          variant={
                            appState.preferences.showLatencyDetails
                              ? "solid"
                              : "soft"
                          }
                          onClick={() => {
                            void updatePreferences({
                              showLatencyDetails:
                                !appState.preferences.showLatencyDetails,
                            });
                          }}
                        >
                          {appState.preferences.showLatencyDetails ? "Hide" : "Show"}
                        </Button>
                      </Flex>
                      <Flex align="center" justify="between" gap="2">
                        <Text size="1">Input</Text>
                        <select
                          className="device-select legacy-compact-select"
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
                      </Flex>
                      <Flex align="center" justify="between" gap="2">
                        <Text size="1">Output</Text>
                        <select
                          className="device-select legacy-compact-select"
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
                      </Flex>
                      <Flex className="compact-setting-row" align="center" justify="between" gap="2">
                        <Text size="1">Capture enabled</Text>
                        <Switch
                          checked={appState.audio.captureEnabled}
                          onCheckedChange={(checked) => {
                            void updateAudioSettings({ captureEnabled: checked });
                          }}
                        />
                      </Flex>
                      <Flex className="compact-setting-row" align="center" justify="between" gap="2">
                        <Text size="1">Push to talk</Text>
                        <Switch
                          checked={appState.preferences.pushToTalk}
                          onCheckedChange={(checked) => {
                            void updatePreferences({ pushToTalk: checked });
                          }}
                        />
                      </Flex>
                      <Flex gap="1" wrap="wrap">
                        {audioPresets.map((preset) => (
                          <Button
                            key={preset.label}
                            size="1"
                            variant="soft"
                            title={preset.description}
                            onClick={() => {
                              applyPreset(preset.settings);
                            }}
                          >
                            {preset.label}
                          </Button>
                        ))}
                      </Flex>
                      <Flex direction="column" gap="1">
                        {dspFeatures.map((feature) => (
                          <Flex
                            key={feature.key}
                            align="center"
                            justify="between"
                            gap="2"
                            title={feature.description}
                          >
                            <Text size="1">{feature.label}</Text>
                            <Switch
                              checked={dspPipeline.settings[feature.key]}
                              onCheckedChange={(enabled) => {
                                const nextPipeline = setDspFeature(
                                  dspPipeline.settings,
                                  feature.key,
                                  enabled,
                                );
                                setDspPipelineState(nextPipeline);
                                void updatePreferences({
                                  voiceProcessing: persistDspSettings(
                                    nextPipeline.settings,
                                  ),
                                });
                              }}
                            />
                          </Flex>
                        ))}
                      </Flex>
                      {appState.preferences.showLatencyDetails ? (
                        <Flex direction="column" gap="1">
                          <Text size="1" color="gray">
                            Latency: {appState.telemetry.latencyMs ?? "—"} ms
                          </Text>
                          <Text size="1" color="gray">
                            Jitter: {appState.telemetry.jitterMs ?? "—"} ms
                          </Text>
                          <Text size="1" color="gray">
                            Packet loss: {appState.telemetry.packetLoss ?? "—"}%
                          </Text>
                          <Text size="1" color="gray">
                            Transport: {describeTransportStatus(voiceTransportStatus)}
                          </Text>
                          <Text size="1" color="gray">
                            {formatTransportActivity(voiceTransportStatus)}
                          </Text>
                        </Flex>
                      ) : null}
                      <Flex gap="1" wrap="wrap">
                        <Button
                          size="1"
                          variant="soft"
                          onClick={() => {
                            void exportDiagnostics();
                          }}
                          disabled={
                            !window.app?.exportDiagnostics || isExportingDiagnostics
                          }
                        >
                          <DownloadIcon />
                          {isExportingDiagnostics ? "Exporting…" : "Export"}
                        </Button>
                        <Button
                          size="1"
                          variant="soft"
                          onClick={() => {
                            void runSelfTest();
                          }}
                          disabled={
                            !window.app?.runSecureVoiceSelfTest ||
                            handshakeState === "running"
                          }
                        >
                          {handshakeState === "running" ? "Running…" : "Self-test"}
                        </Button>
                      </Flex>
                      {selfTestResult ? (
                        <Text
                          size="1"
                          color="gray"
                          style={{ wordBreak: "break-all" }}
                        >
                          {selfTestResult.sessionId} · {selfTestResult.cipherSuite}
                        </Text>
                      ) : null}
                      {diagnosticsMessage ? (
                        <Text size="1" color="green">
                          {diagnosticsMessage}
                        </Text>
                      ) : null}
                      {diagnosticsError ? (
                        <Text size="1" color="ruby">
                          {diagnosticsError}
                        </Text>
                      ) : null}
                      {selfTestError ? (
                        <Text size="1" color="ruby">
                          {selfTestError}
                        </Text>
                      ) : null}
                    </Flex>
                  </div>
                </>,
              )}
            </Grid>
            {closedDockPanels.length > 0 ? (
              <Flex className="legacy-dock-restore-strip" gap="2" wrap="wrap" align="center">
                <Text size="1" color="gray">
                  Closed panels
                </Text>
                {closedDockPanels.map((panelId) => (
                  <Button
                    key={panelId}
                    size="1"
                    variant="soft"
                    onClick={() => {
                      restoreDockPanel(panelId);
                    }}
                  >
                    Restore {DOCK_PANEL_TITLES[panelId]}
                  </Button>
                ))}
              </Flex>
            ) : null}

            <Card className="section-card legacy-minimal-note">
              <Text size="1">{minimalViewNote}</Text>
            </Card>
          </Flex>
        </main>
      </Box>
    </Theme>
  );
}
