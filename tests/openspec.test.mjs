import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const expectFile = async (...segments) => {
  const filePath = path.join(repoRoot, ...segments);
  await access(filePath);
  return filePath;
};

test("OpenSpec scaffolding is available for GitHub Copilot workflows", async () => {
  const promptFiles = [
    "opsx-propose.prompt.md",
    "opsx-apply.prompt.md",
    "opsx-explore.prompt.md",
    "opsx-archive.prompt.md",
  ];
  const skillFiles = [
    ["openspec-propose", "SKILL.md"],
    ["openspec-apply-change", "SKILL.md"],
    ["openspec-explore", "SKILL.md"],
    ["openspec-archive-change", "SKILL.md"],
  ];

  await Promise.all([
    expectFile("openspec", "changes", "archive", ".gitkeep"),
    expectFile("openspec", "specs", ".gitkeep"),
    ...promptFiles.map((fileName) => expectFile(".github", "prompts", fileName)),
    ...skillFiles.map((segments) => expectFile(".github", "skills", ...segments)),
  ]);

  const proposePrompt = await readFile(
    path.join(repoRoot, ".github", "prompts", "opsx-propose.prompt.md"),
    "utf8",
  );
  const proposeSkill = await readFile(
    path.join(repoRoot, ".github", "skills", "openspec-propose", "SKILL.md"),
    "utf8",
  );

  assert.match(proposePrompt, /openspec new change "<name>"/);
  assert.match(proposePrompt, /Run `\/opsx:apply`/);
  assert.match(proposeSkill, /compatibility:\s+Requires openspec CLI\./);
});
