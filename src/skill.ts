import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "whatsapp-cli";

function bundledSkillPath(): string {
  return fileURLToPath(new URL(`../skill/${SKILL_NAME}`, import.meta.url));
}

export function codexSkillPath(): string {
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  return join(codexHome, "skills", SKILL_NAME);
}

export function isCodexSkillInstalled(): boolean {
  return existsSync(join(codexSkillPath(), "SKILL.md"));
}

export async function installCodexSkill(options: {
  force: boolean;
  skillsDirectory?: string;
}): Promise<{ installed: true; path: string }> {
  const source = bundledSkillPath();
  accessSync(join(source, "SKILL.md"), constants.R_OK);

  const target = options.skillsDirectory
    ? join(options.skillsDirectory, SKILL_NAME)
    : codexSkillPath();
  if (existsSync(target)) {
    if (!options.force) {
      throw new Error(
        `Codex skill already exists at ${target}; rerun with --force to replace it`
      );
    }
    rmSync(target, { recursive: true, force: false });
  }

  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  cpSync(source, target, {
    recursive: true,
    errorOnExist: true,
    force: false
  });
  return { installed: true, path: target };
}
