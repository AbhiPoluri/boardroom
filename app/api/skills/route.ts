import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export const dynamic = "force-dynamic";

const SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isValidSkillName(name: unknown): name is string {
  return typeof name === "string" && KEBAB_RE.test(name) && name.length <= 128;
}

function safePath(name: string): string | null {
  if (!isValidSkillName(name)) return null;
  const resolved = path.resolve(SKILLS_DIR, name);
  if (!resolved.startsWith(SKILLS_DIR + path.sep)) return null;
  return resolved;
}

function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const fm: Record<string, unknown> = {};
  let currentKey = "";
  let inNested = false;
  const nested: Record<string, string> = {};

  for (const line of match[1].split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    if (inNested) {
      const nestedMatch = trimmed.match(/^\s{2,}(\w[\w-]*):\s*(.*)$/);
      if (nestedMatch) {
        nested[nestedMatch[1]] = nestedMatch[2].trim();
        continue;
      }
      // End of nested block
      fm[currentKey] = { ...nested };
      inNested = false;
      // Clear nested for reuse
      for (const k of Object.keys(nested)) delete nested[k];
    }

    const kvMatch = trimmed.match(/^([\w][\w-]*):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value === "") {
        // Could be a nested map
        currentKey = key;
        inNested = true;
      } else {
        fm[key] = value;
      }
    }
  }

  if (inNested) {
    fm[currentKey] = { ...nested };
  }

  return { frontmatter: fm, body: match[2] };
}

function buildFrontmatter(data: {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
}): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${data.name}`);
  lines.push(`description: ${data.description}`);
  if (data.license) lines.push(`license: ${data.license}`);
  if (data.compatibility) lines.push(`compatibility: ${data.compatibility}`);
  if (data.metadata && Object.keys(data.metadata).length > 0) {
    lines.push("metadata:");
    for (const [k, v] of Object.entries(data.metadata)) {
      lines.push(`  ${k}: ${v}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function walkDir(dir: string, base: string = dir): { path: string; size: number }[] {
  const results: { path: string; size: number }[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, base));
    } else {
      const stat = fs.statSync(full);
      results.push({ path: path.relative(base, full), size: stat.size });
    }
  }
  return results;
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function rmDirRecursive(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");
    const exportName = searchParams.get("export");

    // --- Export single skill as raw markdown ---
    if (exportName) {
      const skillDir = safePath(exportName);
      if (!skillDir) {
        return NextResponse.json({ error: "Invalid skill name" }, { status: 400 });
      }
      const skillFile = path.join(skillDir, "SKILL.md");
      if (!fs.existsSync(skillFile)) {
        return NextResponse.json({ error: "Skill not found" }, { status: 404 });
      }
      const content = fs.readFileSync(skillFile, "utf-8");
      return new NextResponse(content, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${exportName}-SKILL.md"`,
        },
      });
    }

    // --- Get single skill ---
    if (name) {
      const skillDir = safePath(name);
      if (!skillDir) {
        return NextResponse.json({ error: "Invalid skill name" }, { status: 400 });
      }
      const skillFile = path.join(skillDir, "SKILL.md");
      if (!fs.existsSync(skillFile)) {
        return NextResponse.json({ error: "Skill not found" }, { status: 404 });
      }
      const raw = fs.readFileSync(skillFile, "utf-8");
      const { frontmatter } = parseFrontmatter(raw);
      const files = walkDir(skillDir);

      return NextResponse.json({
        skill: {
          ...frontmatter,
          content: raw,
          files,
        },
      });
    }

    // --- List all skills ---
    if (!fs.existsSync(SKILLS_DIR)) {
      return NextResponse.json({ skills: [] });
    }

    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const skills: Record<string, unknown>[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(SKILLS_DIR, entry.name, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;

      const raw = fs.readFileSync(skillFile, "utf-8");
      const { frontmatter } = parseFrontmatter(raw);
      const skillDir = path.join(SKILLS_DIR, entry.name);
      const fileList = fs.readdirSync(skillDir, { recursive: true }) as string[];

      skills.push({
        name: frontmatter.name || entry.name,
        description: frontmatter.description || "",
        license: frontmatter.license || null,
        compatibility: frontmatter.compatibility || null,
        metadata: frontmatter.metadata || null,
        path: skillDir,
        files: fileList.map(String),
        hasScripts: fs.existsSync(path.join(skillDir, "scripts")),
        hasReferences: fs.existsSync(path.join(skillDir, "references")),
        hasAssets: fs.existsSync(path.join(skillDir, "assets")),
      });
    }

    return NextResponse.json({ skills });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — create, duplicate, import-url
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string | undefined;

    // --- Duplicate ---
    if (action === "duplicate") {
      const { name } = body as { name: string };
      if (!isValidSkillName(name)) {
        return NextResponse.json({ error: "Invalid skill name" }, { status: 400 });
      }
      const srcDir = safePath(name);
      if (!srcDir || !fs.existsSync(srcDir)) {
        return NextResponse.json({ error: "Source skill not found" }, { status: 404 });
      }

      let copyName = `${name}-copy`;
      let copyDir = safePath(copyName);
      let suffix = 2;
      while (copyDir && fs.existsSync(copyDir)) {
        copyName = `${name}-copy-${suffix}`;
        copyDir = safePath(copyName);
        suffix++;
      }
      if (!copyDir) {
        return NextResponse.json({ error: "Failed to generate copy name" }, { status: 500 });
      }

      copyDirRecursive(srcDir, copyDir);

      // Update the name in the copied SKILL.md
      const copiedSkillFile = path.join(copyDir, "SKILL.md");
      if (fs.existsSync(copiedSkillFile)) {
        let content = fs.readFileSync(copiedSkillFile, "utf-8");
        content = content.replace(
          /^(name:\s*).*$/m,
          `$1${copyName}`
        );
        fs.writeFileSync(copiedSkillFile, content, "utf-8");
      }

      return NextResponse.json({
        skill: { name: copyName, path: copyDir },
      });
    }

    // --- Import from URL (future feature) ---
    if (action === "import-url") {
      return NextResponse.json(
        { error: "import-url is not yet implemented" },
        { status: 501 }
      );
    }

    // --- Create new skill ---
    const { name, description, content, license, compatibility, metadata } = body as {
      name: string;
      description: string;
      content?: string;
      license?: string;
      compatibility?: string;
      metadata?: Record<string, string>;
    };

    if (!isValidSkillName(name)) {
      return NextResponse.json(
        { error: "Invalid skill name. Must be kebab-case (lowercase letters, numbers, hyphens)." },
        { status: 400 }
      );
    }

    if (!description || typeof description !== "string") {
      return NextResponse.json(
        { error: "description is required" },
        { status: 400 }
      );
    }

    if (description.length > 1024) {
      return NextResponse.json(
        { error: "description exceeds 1024 character limit" },
        { status: 400 }
      );
    }

    const skillDir = safePath(name);
    if (!skillDir) {
      return NextResponse.json({ error: "Invalid skill name" }, { status: 400 });
    }

    if (fs.existsSync(skillDir)) {
      return NextResponse.json(
        { error: `Skill '${name}' already exists` },
        { status: 409 }
      );
    }

    fs.mkdirSync(skillDir, { recursive: true });

    const frontmatterBlock = buildFrontmatter({
      name,
      description,
      license,
      compatibility,
      metadata,
    });

    const bodyContent = content || `\n# ${name}\n\nSkill instructions go here.\n`;
    const skillMd = frontmatterBlock + "\n" + bodyContent;
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");

    return NextResponse.json(
      {
        skill: { name, description, path: skillDir },
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PUT — update SKILL.md content
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, content } = body as { name: string; content: string };

    if (!isValidSkillName(name)) {
      return NextResponse.json({ error: "Invalid skill name" }, { status: 400 });
    }

    if (!content || typeof content !== "string") {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    if (content.length > 500000) {
      return NextResponse.json({ error: "content too large" }, { status: 400 });
    }

    const skillDir = safePath(name);
    if (!skillDir || !fs.existsSync(skillDir)) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const skillFile = path.join(skillDir, "SKILL.md");
    fs.writeFileSync(skillFile, content, "utf-8");

    const { frontmatter } = parseFrontmatter(content);

    return NextResponse.json({
      skill: {
        name: frontmatter.name || name,
        description: frontmatter.description || "",
        path: skillDir,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove a skill folder
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { name } = body as { name: string };

    if (!isValidSkillName(name)) {
      return NextResponse.json({ error: "Invalid skill name" }, { status: 400 });
    }

    const skillDir = safePath(name);
    if (!skillDir || !fs.existsSync(skillDir)) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    rmDirRecursive(skillDir);

    return NextResponse.json({ deleted: name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
