import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCodexSkill } from "../src/skill.js";

describe("Codex skill installer", () => {
  it("installs the bundled skill and requires force to replace it", async () => {
    const directory = mkdtempSync(join(tmpdir(), "whatsapp-cli-skill-"));
    const target = join(directory, "whatsapp-cli");
    try {
      const installed = await installCodexSkill({
        force: false,
        skillsDirectory: directory
      });
      expect(installed.path).toBe(target);
      expect(existsSync(join(target, "SKILL.md"))).toBe(true);

      await expect(
        installCodexSkill({ force: false, skillsDirectory: directory })
      ).rejects.toThrow("already exists");

      writeFileSync(join(target, "stale"), "stale");
      await installCodexSkill({ force: true, skillsDirectory: directory });
      expect(existsSync(join(target, "stale"))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
