const STORAGE_KEY = "mumble:base16-theme";

const REQUIRED_KEYS = [
  "base00",
  "base01",
  "base02",
  "base03",
  "base04",
  "base05",
  "base06",
  "base07",
  "base08",
  "base0A",
  "base0B",
  "base0C",
  "base0D",
  "base0E",
  "base0F",
] as const;

type Base16ColorKey = (typeof REQUIRED_KEYS)[number];

export type Base16Theme = {
  scheme: string;
  author: string | null;
  colors: Record<Base16ColorKey, string>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeColor = (value: unknown, key: Base16ColorKey) => {
  if (typeof value !== "string") {
    throw new Error(`Base16 theme is missing ${key}.`);
  }

  const normalizedValue = value.trim().replace(/^['"]|['"]$/g, "");
  const hexValue = normalizedValue.startsWith("#")
    ? normalizedValue.slice(1)
    : normalizedValue;
  if (!/^[\da-fA-F]{6}$/.test(hexValue)) {
    throw new Error(`Base16 ${key} must be a 6-digit hex color.`);
  }

  return `#${hexValue.toLowerCase()}`;
};

const parseYamlLikeTheme = (rawTheme: string) =>
  rawTheme.split(/\r?\n/).reduce<Record<string, string>>((theme, rawLine) => {
    const trimmedLine = rawLine.trim();
    if (
      trimmedLine.length === 0 ||
      trimmedLine === "---" ||
      trimmedLine.startsWith("!")
    ) {
      return theme;
    }

    const sanitizedLine = trimmedLine.replace(/\s+#.*$/, "").trim();
    const match = sanitizedLine.match(/^([A-Za-z0-9]+)\s*:\s*(.+)$/);
    if (!match) {
      return theme;
    }

    const [, key, rawValue] = match;
    theme[key] = rawValue.trim().replace(/^['"]|['"]$/g, "");
    return theme;
  }, {});

const parseRawTheme = (rawTheme: string) => {
  const trimmedTheme = rawTheme.trim();
  if (trimmedTheme.length === 0) {
    throw new Error("Paste a Base16 YAML or JSON theme.");
  }

  if (trimmedTheme.startsWith("{")) {
    const parsedTheme = JSON.parse(trimmedTheme) as unknown;
    if (isRecord(parsedTheme)) {
      return parsedTheme;
    }
  }

  return parseYamlLikeTheme(trimmedTheme);
};

const getRelativeLuminance = (hexColor: string) => {
  const [red, green, blue] = [1, 3, 5].map((startIndex) =>
    Number.parseInt(hexColor.slice(startIndex, startIndex + 2), 16) / 255,
  );
  const toLinear = (channel: number) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;

  return (
    0.2126 * toLinear(red) +
    0.7152 * toLinear(green) +
    0.0722 * toLinear(blue)
  );
};

const isDarkTheme = (backgroundColor: string, foregroundColor: string) =>
  getRelativeLuminance(backgroundColor) < getRelativeLuminance(foregroundColor);

const toRgbTuple = (hexColor: string) =>
  [1, 3, 5]
    .map((startIndex) => Number.parseInt(hexColor.slice(startIndex, startIndex + 2), 16))
    .join(" ");

export const parseBase16Theme = (rawTheme: string): Base16Theme => {
  const parsedTheme = parseRawTheme(rawTheme);
  const colors = Object.fromEntries(
    REQUIRED_KEYS.map((key) => [key, normalizeColor(parsedTheme[key], key)]),
  ) as Record<Base16ColorKey, string>;
  if (!isDarkTheme(colors.base00, colors.base05)) {
    throw new Error("Only dark Base16 themes are supported.");
  }

  return {
    scheme:
      typeof parsedTheme.scheme === "string" && parsedTheme.scheme.trim().length > 0
        ? parsedTheme.scheme.trim()
        : "Imported Base16",
    author:
      typeof parsedTheme.author === "string" && parsedTheme.author.trim().length > 0
        ? parsedTheme.author.trim()
        : null,
    colors,
  };
};

export const parseStoredBase16Theme = (value: unknown): Base16Theme | null => {
  if (!isRecord(value) || !isRecord(value.colors)) {
    return null;
  }

  try {
    const colors = Object.fromEntries(
      REQUIRED_KEYS.map((key) => [key, normalizeColor(value.colors[key], key)]),
    ) as Record<Base16ColorKey, string>;
    if (!isDarkTheme(colors.base00, colors.base05)) {
      return null;
    }

    return {
      scheme:
        typeof value.scheme === "string" && value.scheme.trim().length > 0
          ? value.scheme.trim()
          : "Imported Base16",
      author:
        typeof value.author === "string" && value.author.trim().length > 0
          ? value.author.trim()
          : null,
      colors,
    };
  } catch {
    return null;
  }
};

export const buildBase16ThemeVariables = (theme: Base16Theme) =>
  ({
    "--app-bg": theme.colors.base00,
    "--app-bg-soft": theme.colors.base01,
    "--app-surface": theme.colors.base01,
    "--app-surface-strong": theme.colors.base02,
    "--app-border": theme.colors.base02,
    "--app-border-strong": theme.colors.base03,
    "--app-accent": theme.colors.base0D,
    "--app-accent-2": theme.colors.base0C,
    "--app-text": theme.colors.base05,
    "--app-muted": theme.colors.base04,
    "--app-success": theme.colors.base0B,
    "--app-warning": theme.colors.base0A,
    "--app-danger": theme.colors.base08,
    "--app-bg-rgb": toRgbTuple(theme.colors.base00),
    "--app-surface-rgb": toRgbTuple(theme.colors.base01),
    "--app-surface-strong-rgb": toRgbTuple(theme.colors.base02),
    "--app-border-rgb": toRgbTuple(theme.colors.base02),
    "--app-border-strong-rgb": toRgbTuple(theme.colors.base03),
    "--app-text-rgb": toRgbTuple(theme.colors.base05),
    "--app-accent-rgb": toRgbTuple(theme.colors.base0D),
    "--app-accent-2-rgb": toRgbTuple(theme.colors.base0C),
  }) satisfies Record<string, string>;

export const loadStoredBase16Theme = (
  storage: Pick<Storage, "getItem"> | undefined,
) => {
  if (!storage) {
    return null;
  }

  const storedTheme = storage.getItem(STORAGE_KEY);
  if (!storedTheme) {
    return null;
  }

  try {
    const parsedStoredTheme = JSON.parse(storedTheme) as unknown;
    return parseStoredBase16Theme(parsedStoredTheme);
  } catch {
    return null;
  }
};

export const storeBase16Theme = (
  storage: Pick<Storage, "setItem"> | undefined,
  theme: Base16Theme,
) => {
  storage?.setItem(STORAGE_KEY, JSON.stringify(theme));
};

export const clearStoredBase16Theme = (
  storage: Pick<Storage, "removeItem"> | undefined,
) => {
  storage?.removeItem(STORAGE_KEY);
};
