import assert from "node:assert/strict";
import test from "node:test";

import { buildFailedConnectionRecovery } from "../src/connectionRecovery";

test("address-related failures recommend host and port checks before retrying", () => {
  const recovery = buildFailedConnectionRecovery("Server ports must be between 1 and 65535.", {
    serverAddress: "voice.example.test:70000",
    nickname: "Scout"
  });

  assert.equal(recovery.summary, "Review voice.example.test:70000 before retrying the join request.");
  assert.equal(recovery.steps[0], "Check the host and port format. IPv6 addresses should use [host]:port notation.");
  assert.match(recovery.steps[2], /Retry voice\.example\.test:70000/);
});

test("nickname-related failures guide the user back to identity setup", () => {
  const recovery = buildFailedConnectionRecovery("Enter a nickname before joining.", {
    serverAddress: "voice.example.test:64738"
  });

  assert.equal(recovery.summary, "Update the identity details and retry once the form is complete.");
  assert.equal(recovery.steps[0], "Set a nickname before joining voice.example.test:64738.");
  assert.match(recovery.steps[2], /Retry the connection/);
});

test("generic failures keep retry and diagnostics guidance available", () => {
  const recovery = buildFailedConnectionRecovery("Timed out waiting for the server.", {
    serverAddress: "voice.example.test:64738",
    nickname: "Scout"
  });

  assert.equal(recovery.summary, "Inspect the failure details for voice.example.test:64738 and retry when ready.");
  assert.equal(recovery.steps[1], "Retry voice.example.test:64738 as Scout after the issue is resolved.");
  assert.equal(recovery.steps[2], "Open diagnostics if you want to capture logs before trying again.");
});
