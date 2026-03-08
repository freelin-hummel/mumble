export const SYSTEM_DEFAULT_DEVICE_ID = "default";

export type AudioDeviceKind = "audioinput" | "audiooutput";

export type BrowserAudioDevice = Pick<MediaDeviceInfo, "deviceId" | "groupId" | "kind" | "label">;

export type AudioDeviceOption = {
  id: string;
  label: string;
  isDefault: boolean;
};

export type AudioRoute = {
  selectedId: string;
  resolvedId: string | null;
  requestedLabel: string;
  resolvedLabel: string;
  usesDefault: boolean;
};

export type AudioDeviceState = {
  supported: boolean;
  error: string | null;
  selectedInputId: string;
  selectedOutputId: string;
  inputRoute: AudioRoute;
  outputRoute: AudioRoute;
  inputs: AudioDeviceOption[];
  outputs: AudioDeviceOption[];
  detectedInputCount: number;
  detectedOutputCount: number;
};

export type AudioDeviceSelections = {
  inputId?: string;
  outputId?: string;
};

export type AudioProcessingConstraints = {
  agc?: boolean;
  noiseSuppression?: boolean;
  echoCancellation?: boolean;
};

export type MediaDevicesLike = Pick<MediaDevices, "enumerateDevices" | "addEventListener" | "removeEventListener">;

type OutputSinkTarget = {
  setSinkId?: (sinkId: string) => Promise<unknown>;
};

type DeviceCollection = {
  options: AudioDeviceOption[];
  detectedCount: number;
  defaultDevice: BrowserAudioDevice | null;
  selectableDevices: BrowserAudioDevice[];
};

const emptyRoute = {
  selectedId: SYSTEM_DEFAULT_DEVICE_ID,
  resolvedId: null,
  requestedLabel: "System default",
  resolvedLabel: "No device detected",
  usesDefault: true
} satisfies AudioRoute;

export function buildAudioDeviceState(
  devices: BrowserAudioDevice[],
  selections: AudioDeviceSelections = {},
  options: { supported?: boolean; error?: string | null } = {}
): AudioDeviceState {
  const inputs = collectDevices(devices, "audioinput");
  const outputs = collectDevices(devices, "audiooutput");

  const selectedInputId = normalizeSelectionId(selections.inputId, inputs.options);
  const selectedOutputId = normalizeSelectionId(selections.outputId, outputs.options);

  return {
    supported: options.supported ?? true,
    error: options.error ?? null,
    selectedInputId,
    selectedOutputId,
    inputRoute: resolveRoute(inputs, selectedInputId, "Input"),
    outputRoute: resolveRoute(outputs, selectedOutputId, "Output"),
    inputs: inputs.options,
    outputs: outputs.options,
    detectedInputCount: inputs.detectedCount,
    detectedOutputCount: outputs.detectedCount
  };
}

export function createInputDeviceConstraints(
  selectedInputId: string,
  audioProcessing: AudioProcessingConstraints = {}
): MediaTrackConstraints | true {
  const baseConstraints: MediaTrackConstraints = {};
  if (typeof audioProcessing.agc === "boolean") {
    baseConstraints.autoGainControl = audioProcessing.agc;
  }
  if (typeof audioProcessing.noiseSuppression === "boolean") {
    baseConstraints.noiseSuppression = audioProcessing.noiseSuppression;
  }
  if (typeof audioProcessing.echoCancellation === "boolean") {
    baseConstraints.echoCancellation = audioProcessing.echoCancellation;
  }

  if (selectedInputId === SYSTEM_DEFAULT_DEVICE_ID) {
    return Object.values(baseConstraints).some((value) => typeof value === "boolean")
      ? baseConstraints
      : true;
  }

  return {
    ...baseConstraints,
    deviceId: {
      exact: selectedInputId
    }
  };
}

export async function applyOutputDeviceSelection(
  audioElement: OutputSinkTarget | null,
  selectedOutputId: string
): Promise<boolean> {
  if (!audioElement || typeof audioElement.setSinkId !== "function") {
    return false;
  }

  await audioElement.setSinkId(selectedOutputId === SYSTEM_DEFAULT_DEVICE_ID ? "" : selectedOutputId);
  return true;
}

export function subscribeToAudioDeviceChanges(
  mediaDevices: MediaDevicesLike,
  onDeviceChange: () => void | Promise<void>
): () => void {
  const listener = () => {
    void onDeviceChange();
  };

  mediaDevices.addEventListener("devicechange", listener);

  return () => {
    mediaDevices.removeEventListener("devicechange", listener);
  };
}

function collectDevices(devices: BrowserAudioDevice[], kind: AudioDeviceKind): DeviceCollection {
  const filteredDevices = devices.filter((device) => device.kind === kind);
  const selectableDevices = filteredDevices.filter((device) => device.deviceId !== SYSTEM_DEFAULT_DEVICE_ID);
  const reportedDefaultDevice = filteredDevices.find((device) => device.deviceId === SYSTEM_DEFAULT_DEVICE_ID) ?? null;
  const defaultDevice = reportedDefaultDevice ?? selectableDevices[0] ?? null;

  return {
    options: [
      {
        id: SYSTEM_DEFAULT_DEVICE_ID,
        label: defaultDevice
          ? `System default (${formatDeviceLabel(defaultDevice, 0, kind)})`
          : "System default",
        isDefault: true
      },
      ...selectableDevices.map((device, index) => ({
        id: device.deviceId,
        label: formatDeviceLabel(device, index, kind),
        isDefault: false
      }))
    ],
    detectedCount: selectableDevices.length,
    defaultDevice,
    selectableDevices
  };
}

function normalizeSelectionId(selectionId: string | undefined, options: AudioDeviceOption[]): string {
  const requestedId = selectionId ?? SYSTEM_DEFAULT_DEVICE_ID;

  return options.some((option) => option.id === requestedId)
    ? requestedId
    : SYSTEM_DEFAULT_DEVICE_ID;
}

function resolveRoute(collection: DeviceCollection, selectedId: string, fallbackLabel: string): AudioRoute {
  if (selectedId === SYSTEM_DEFAULT_DEVICE_ID) {
    if (!collection.defaultDevice) {
      return emptyRoute;
    }

    return {
      selectedId,
      resolvedId: collection.defaultDevice.deviceId,
      requestedLabel: "System default",
      resolvedLabel: formatDeviceLabel(collection.defaultDevice, 0, collection.defaultDevice.kind),
      usesDefault: true
    };
  }

  const selectedDevice = collection.selectableDevices.find((device) => device.deviceId === selectedId);
  if (!selectedDevice) {
    return collection.defaultDevice
      ? {
          selectedId: SYSTEM_DEFAULT_DEVICE_ID,
          resolvedId: collection.defaultDevice.deviceId,
          requestedLabel: "System default",
          resolvedLabel: formatDeviceLabel(collection.defaultDevice, 0, collection.defaultDevice.kind),
          usesDefault: true
        }
      : {
          ...emptyRoute,
          requestedLabel: fallbackLabel
        };
  }

  return {
    selectedId,
    resolvedId: selectedDevice.deviceId,
    requestedLabel: formatDeviceLabel(selectedDevice, 0, selectedDevice.kind),
    resolvedLabel: formatDeviceLabel(selectedDevice, 0, selectedDevice.kind),
    usesDefault: false
  };
}

function formatDeviceLabel(device: BrowserAudioDevice, index: number, kind: AudioDeviceKind): string {
  const label = device.label.trim();
  if (label) {
    return label;
  }

  return `${kind === "audioinput" ? "Input" : "Output"} ${index + 1}`;
}
