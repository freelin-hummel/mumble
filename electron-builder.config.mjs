import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const legacyIconsDir = path.join(__dirname, "legacy", "icons");

const windowsCertificateSubject = process.env.WIN_CSC_SUBJECT_NAME?.trim();
const macIdentity = process.env.CSC_NAME?.trim();

const config = {
  appId: "info.mumble.client",
  productName: "Mumble",
  artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
  directories: {
    output: "release"
  },
  files: ["dist/**/*", "package.json", "LICENSE"],
  extraMetadata: {
    main: "dist/electron/main.js"
  },
  mac: {
    category: "public.app-category.social-networking",
    target: ["dmg", "zip"],
    icon: path.join(legacyIconsDir, "mumble.icns"),
    identity: macIdentity || null
  },
  win: {
    target: ["nsis"],
    icon: path.join(legacyIconsDir, "mumble.ico"),
    ...(windowsCertificateSubject ? { certificateSubjectName: windowsCertificateSubject } : {})
  },
  linux: {
    target: ["AppImage", "deb"],
    category: "Network",
    icon: path.join(legacyIconsDir, "mumble_256x256.png")
  }
};

export default config;
