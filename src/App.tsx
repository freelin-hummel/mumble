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
  GlobeIcon,
  LightningBoltIcon,
  MixerHorizontalIcon,
  PersonIcon,
  SpeakerLoudIcon,
  SpeakerOffIcon
} from "@radix-ui/react-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyOutputDeviceSelection,
  buildAudioDeviceState,
  subscribeToAudioDeviceChanges,
  SYSTEM_DEFAULT_DEVICE_ID,
  type BrowserAudioDevice
} from "./audioDevices";
import { QuickAction } from "./components/QuickAction";
import { SectionHeader } from "./components/SectionHeader";
import { StatusChip } from "./components/StatusChip";

const channelUsers = [
  { name: "Aster", status: "live" },
  { name: "Milo", status: "muted" },
  { name: "Quinn", status: "idle" },
  { name: "Rhea", status: "live" }
] as const;

const audioPresets = [
  { label: "Studio clarity", description: "Wideband, low noise gate" },
  { label: "Party mode", description: "Boost presence and limiter" },
  { label: "Late night", description: "Soft compressor, warm EQ" }
];

export function App() {
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
  const outputPreviewRef = useRef<HTMLAudioElement>(null);
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
                      Live prototype
                    </Badge>
                    <Heading size="8">Mumble, reimagined for desktop and web</Heading>
                    <Text size="3" color="gray">
                      Fast join, low-latency voice, and composable controls powered by Radix UI.
                    </Text>
                    <Flex gap="3" wrap="wrap">
                      <TextField.Root size="3" placeholder="Server address" style={{ minWidth: 240 }}>
                        <TextField.Slot>
                          <GlobeIcon />
                        </TextField.Slot>
                      </TextField.Root>
                      <TextField.Root size="3" placeholder="Nickname" style={{ minWidth: 200 }}>
                        <TextField.Slot>
                          <ChatBubbleIcon />
                        </TextField.Slot>
                      </TextField.Root>
                      <Button size="3">Join voice</Button>
                    </Flex>
                    <Flex gap="3" align="center">
                      <StatusChip status="live" label="Low jitter" />
                      <StatusChip status="idle" label={`Running on ${platformLabel}`} />
                    </Flex>
                  </Flex>
                </Box>
                <Card className="section-card" style={{ minWidth: 260 }}>
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
                            setSelectedInputId(event.target.value);
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
                            setSelectedOutputId(event.target.value);
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
                          ? "Notification audio follows the selected output device."
                          : "Output routing is tracked and will be applied when sink switching is supported."}
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
                  <SectionHeader title="Active room" subtitle="Nebula Lounge" />
                  <Flex direction="column" gap="3">
                    {channelUsers.map((user) => (
                      <Flex key={user.name} align="center" justify="between">
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
                          <Text size="3">{user.name}</Text>
                        </Flex>
                        <StatusChip status={user.status} label={user.status} />
                      </Flex>
                    ))}
                  </Flex>
                </Flex>
              </Card>

              <Card className="section-card fade-in delay-2">
                <Flex direction="column" gap="4">
                  <SectionHeader
                    title="Audio chain"
                    subtitle="Reusable, composable modules"
                    action={<IconButton variant="ghost"><MixerHorizontalIcon /></IconButton>}
                  />
                  <Grid columns={{ initial: "1", sm: "2" }} gap="3">
                    {audioPresets.map((preset) => (
                      <Card key={preset.label} className="section-card">
                        <Flex direction="column" gap="2">
                          <Text weight="bold">{preset.label}</Text>
                          <Text size="2" color="gray">{preset.description}</Text>
                          <Button variant="soft" size="2">Apply</Button>
                        </Flex>
                      </Card>
                    ))}
                  </Grid>
                  <Separator size="4" />
                  <Flex align="center" justify="between">
                    <Text size="2" color="gray">Adaptive gain</Text>
                    <Switch defaultChecked />
                  </Flex>
                </Flex>
              </Card>

              <Card className="section-card fade-in delay-3">
                <Flex direction="column" gap="4">
                  <SectionHeader title="Quick actions" subtitle="Small, reusable controls" />
                  <Grid columns={{ initial: "1", sm: "2" }} gap="3">
                    <QuickAction title="Mute" description="Push-to-talk guard" icon={<SpeakerOffIcon />} />
                    <QuickAction title="Output" description="Route to headset" icon={<SpeakerLoudIcon />} />
                    <QuickAction title="Latency" description="Realtime diagnostics" icon={<LightningBoltIcon />} />
                    <QuickAction title="Rooms" description="Switch channels" icon={<ChatBubbleIcon />} />
                  </Grid>
                </Flex>
              </Card>

              <Card className="section-card fade-in delay-3">
                <Flex direction="column" gap="4">
                  <SectionHeader title="Session notes" subtitle="Voice-ready handoff" />
                  <Text size="2" color="gray">
                    This repo now targets a single Electron client. Legacy native code is preserved
                    under the legacy/ folder for reference only.
                  </Text>
                  <Flex gap="3">
                    <Button variant="solid">Open release checklist</Button>
                    <Button variant="soft">Sync settings</Button>
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
