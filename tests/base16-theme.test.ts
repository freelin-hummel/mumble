import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBase16ThemeVariables,
  clearStoredBase16Theme,
  loadStoredBase16Theme,
  parseBase16Theme,
  storeBase16Theme,
} from "../src/base16Theme.js";

const solarizedDarkTheme = `
scheme: "Solarized Dark"
author: "Ethan Schoonover"
base00: "002b36"
base01: "073642"
base02: "586e75"
base03: "657b83"
base04: "839496"
base05: "93a1a1"
base06: "eee8d5"
base07: "fdf6e3"
base08: "dc322f"
base09: "cb4b16"
base0A: "b58900"
base0B: "859900"
base0C: "2aa198"
base0D: "268bd2"
base0E: "6c71c4"
base0F: "d33682"
`;

test("parseBase16Theme accepts dark Base16 YAML themes", () => {
  const theme = parseBase16Theme(solarizedDarkTheme);

  assert.equal(theme.scheme, "Solarized Dark");
  assert.equal(theme.author, "Ethan Schoonover");
  assert.equal(theme.colors.base00, "#002b36");
  assert.equal(theme.colors.base0D, "#268bd2");
});

test("parseBase16Theme accepts JSON themes and rejects light themes", () => {
  const jsonTheme = JSON.stringify({
    scheme: "Tokyo Night",
    base00: "1a1b26",
    base01: "16161e",
    base02: "2f3549",
    base03: "444b6a",
    base04: "787c99",
    base05: "a9b1d6",
    base06: "cbccd1",
    base07: "d5d6db",
    base08: "c0caf5",
    base09: "a9b1d6",
    base0A: "0db9d7",
    base0B: "9ece6a",
    base0C: "b4f9f8",
    base0D: "2ac3de",
    base0E: "bb9af7",
    base0F: "f7768e",
  });
  const parsedTheme = parseBase16Theme(jsonTheme);

  assert.equal(parsedTheme.scheme, "Tokyo Night");
  assert.throws(
    () =>
      parseBase16Theme(`
scheme: "Paper"
base00: "f2f2f2"
base01: "e6e6e6"
base02: "d9d9d9"
base03: "cccccc"
base04: "999999"
base05: "333333"
base06: "222222"
base07: "111111"
base08: "ff0000"
base09: "ff8800"
base0A: "ffff00"
base0B: "00ff00"
base0C: "00ffff"
base0D: "0000ff"
base0E: "ff00ff"
base0F: "880000"
`),
    /Only dark Base16 themes are supported/,
  );
});

test("Base16 theme storage round-trips parsed themes and variables", () => {
  const storage = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  };

  const theme = parseBase16Theme(solarizedDarkTheme);
  storeBase16Theme(fakeStorage, theme);

  const storedTheme = loadStoredBase16Theme(fakeStorage);
  assert.deepEqual(storedTheme, theme);

  const variables = buildBase16ThemeVariables(theme);
  assert.equal(variables["--app-bg"], "#002b36");
  assert.equal(variables["--app-accent-rgb"], "38 139 210");

  clearStoredBase16Theme(fakeStorage);
  assert.equal(loadStoredBase16Theme(fakeStorage), null);
});
