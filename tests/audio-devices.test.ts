import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOutputDeviceSelection,
  buildAudioDeviceState,
  createInputDeviceConstraints,
  subscribeToAudioDeviceChanges,
  SYSTEM_DEFAULT_DEVICE_ID,
  type BrowserAudioDevice,
  type MediaDevicesLike
} from "../src/audioDevices";

const inputDevices: BrowserAudioDevice[] = [
  { deviceId: "default", groupId: "mic-group", kind: "audioinput", label: "Built-in Microphone" },
  { deviceId: "mic-usb", groupId: "usb-group", kind: "audioinput", label: "USB Podcast Mic" }
];

const outputDevices: BrowserAudioDevice[] = [
  { deviceId: "default", groupId: "speaker-group", kind: "audiooutput", label: "Studio Monitor" },
  { deviceId: "speaker-usb", groupId: "usb-speaker-group", kind: "audiooutput", label: "USB Headset" }
];

test("buildAudioDeviceState enumerates input and output devices with system defaults", () => {
  const state = buildAudioDeviceState([...inputDevices, ...outputDevices]);

  assert.equal(state.selectedInputId, SYSTEM_DEFAULT_DEVICE_ID);
  assert.equal(state.selectedOutputId, SYSTEM_DEFAULT_DEVICE_ID);
  assert.equal(state.detectedInputCount, 1);
  assert.equal(state.detectedOutputCount, 1);
  assert.equal(state.inputs[0]?.label, "System default (Built-in Microphone)");
  assert.equal(state.outputs[0]?.label, "System default (Studio Monitor)");
  assert.equal(state.inputRoute.resolvedLabel, "Built-in Microphone");
  assert.equal(state.outputRoute.resolvedLabel, "Studio Monitor");
});

test("explicit device selection updates the resolved routes and capture constraints", () => {
  const state = buildAudioDeviceState(
    [...inputDevices, ...outputDevices],
    {
      inputId: "mic-usb",
      outputId: "speaker-usb"
    }
  );

  assert.equal(state.inputRoute.usesDefault, false);
  assert.equal(state.outputRoute.usesDefault, false);
  assert.equal(state.inputRoute.resolvedId, "mic-usb");
  assert.equal(state.outputRoute.resolvedId, "speaker-usb");
  assert.deepEqual(createInputDeviceConstraints(state.selectedInputId), {
    deviceId: {
      exact: "mic-usb"
    }
  });
  assert.equal(createInputDeviceConstraints(SYSTEM_DEFAULT_DEVICE_ID), true);
});

test("refreshing after hot-swap falls back to the current default when a selected device disappears", () => {
  const state = buildAudioDeviceState(
    [
      { deviceId: "default", groupId: "mic-group", kind: "audioinput", label: "Built-in Microphone" },
      { deviceId: "mic-usb", groupId: "usb-group", kind: "audioinput", label: "USB Podcast Mic" },
      { deviceId: "default", groupId: "speaker-group", kind: "audiooutput", label: "Studio Monitor" },
      { deviceId: "speaker-usb", groupId: "usb-speaker-group", kind: "audiooutput", label: "USB Headset" }
    ],
    {
      inputId: "mic-usb",
      outputId: "speaker-usb"
    }
  );

  const refreshedState = buildAudioDeviceState(
    [
      { deviceId: "default", groupId: "mic-group", kind: "audioinput", label: "Built-in Microphone" },
      { deviceId: "default", groupId: "speaker-group", kind: "audiooutput", label: "Studio Monitor" }
    ],
    {
      inputId: state.selectedInputId,
      outputId: state.selectedOutputId
    }
  );

  assert.equal(refreshedState.selectedInputId, SYSTEM_DEFAULT_DEVICE_ID);
  assert.equal(refreshedState.selectedOutputId, SYSTEM_DEFAULT_DEVICE_ID);
  assert.equal(refreshedState.inputRoute.resolvedLabel, "Built-in Microphone");
  assert.equal(refreshedState.outputRoute.resolvedLabel, "Studio Monitor");
});

test("default-device changes update routing while the system default selection stays active", () => {
  const initialState = buildAudioDeviceState([...inputDevices, ...outputDevices]);
  const refreshedState = buildAudioDeviceState(
    [
      { deviceId: "default", groupId: "wireless-mic", kind: "audioinput", label: "Wireless Mic" },
      { deviceId: "wireless-mic-id", groupId: "wireless-mic", kind: "audioinput", label: "Wireless Mic" },
      { deviceId: "default", groupId: "dock-speaker", kind: "audiooutput", label: "Dock Speakers" },
      { deviceId: "dock-speaker-id", groupId: "dock-speaker", kind: "audiooutput", label: "Dock Speakers" }
    ],
    {
      inputId: initialState.selectedInputId,
      outputId: initialState.selectedOutputId
    }
  );

  assert.equal(refreshedState.selectedInputId, SYSTEM_DEFAULT_DEVICE_ID);
  assert.equal(refreshedState.selectedOutputId, SYSTEM_DEFAULT_DEVICE_ID);
  assert.equal(refreshedState.inputRoute.resolvedLabel, "Wireless Mic");
  assert.equal(refreshedState.outputRoute.resolvedLabel, "Dock Speakers");
});

test("applyOutputDeviceSelection uses sink IDs when supported", async () => {
  const sinkIds: string[] = [];
  const audioElement = {
    async setSinkId(sinkId: string) {
      sinkIds.push(sinkId);
    }
  };

  assert.equal(await applyOutputDeviceSelection(audioElement, "speaker-usb"), true);
  assert.equal(await applyOutputDeviceSelection(audioElement, SYSTEM_DEFAULT_DEVICE_ID), true);
  assert.deepEqual(sinkIds, ["speaker-usb", ""]);
  assert.equal(await applyOutputDeviceSelection(null, "speaker-usb"), false);
});

test("subscribeToAudioDeviceChanges wires and unwires the devicechange listener", async () => {
  let listener: (() => void) | undefined;
  let refreshes = 0;
  const mediaDevices: MediaDevicesLike = {
    enumerateDevices: async () => [],
    addEventListener(eventName, eventListener) {
      assert.equal(eventName, "devicechange");
      listener = eventListener as () => void;
    },
    removeEventListener(eventName, eventListener) {
      assert.equal(eventName, "devicechange");
      assert.equal(eventListener, listener);
      listener = undefined;
    }
  };

  const unsubscribe = subscribeToAudioDeviceChanges(mediaDevices, async () => {
    refreshes += 1;
  });

  listener?.();
  await Promise.resolve();
  assert.equal(refreshes, 1);

  unsubscribe();
  assert.equal(listener, undefined);
});
