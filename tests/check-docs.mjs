#!/usr/bin/env node
// -----------------------------------------------------------------------------
// prompt-master structural docs check
//
// Run with:  node tests/check-docs.mjs
// Exits 0 when everything holds together, 1 when anything is broken.
//
// This is a *structural* suite. It never asserts that a document says a
// particular thing. Every assertion derives both sides from the files at
// runtime and compares them, so renaming a template or bumping a version is
// only ever reported when the rename left something behind.
//
// It never stops at the first problem. One run reports every break it can
// find, each with the offending string quoted and the file it came from.
//
// No dependencies, no package.json, no test runner. Plain Node ESM.
// -----------------------------------------------------------------------------

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// -----------------------------------------------------------------------------
// Routing alias map
// -----------------------------------------------------------------------------
// A row in SKILL.md's Routing Index normally names exactly one profile heading
// in references/tool-profiles.md. A few rows legitimately cover two profiles,
// because one routing decision sends the reader to a pair of sections.
//
// List those here. Key is the exact text of the "Profile to read" cell; value
// is the list of profile labels that cell stands for.
//
// Add an entry when a routing cell should resolve to MORE THAN ONE profile.
// You do NOT need an entry when the profile heading merely appends a
// parenthetical or a dash suffix to the cell text, e.g. cell "Ollama" matching
// heading "## Ollama (local model deployment)". That is handled automatically.
const ROUTING_ALIASES = {
  'Qwen 2.5 / Qwen3': ['Qwen 2.5', 'Qwen3'],
};

// -----------------------------------------------------------------------------
// Failure collection
// -----------------------------------------------------------------------------

const CHECKS = [];
const failures = [];

function check(id, name, fn) {
  CHECKS.push({ id, name, fn });
}

let currentCheck = null;

/**
 * Record a failure. `title` is a one-line headline; `details` is an array of
 * plain lines that name the file and quote the offending string.
 */
function fail(title, details = []) {
  failures.push({ check: currentCheck, title, details: [].concat(details) });
}

// -----------------------------------------------------------------------------
// File helpers
// -----------------------------------------------------------------------------

const fileCache = new Map();

/**
 * Read a repo-relative file as text with line endings normalised to LF.
 *
 * CRLF normalisation is defensive, not cosmetic. The tree is pure LF today,
 * but core.autocrlf=true with no .gitattributes means a fresh clone on Windows
 * lands CRLF while CI checks out LF. A stray \r captured into a regex group
 * would then make heading-versus-table-cell comparisons fail on one machine
 * and pass on the other, which is the worst failure mode this suite could
 * have. Normalising on every read costs nothing and removes the class.
 */
function read(rel) {
  if (fileCache.has(rel)) return fileCache.get(rel);
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    fileCache.set(rel, null);
    return null;
  }
  let text = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  fileCache.set(rel, text);
  return text;
}

function readJson(rel) {
  const text = read(rel);
  if (text === null) return { ok: false, error: 'file not found' };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function toRel(abs) {
  return abs.slice(ROOT.length + 1).split(sep).join('/');
}

/** Every markdown file in the repo, .git and node_modules excluded. */
function markdownFiles() {
  const out = [];
  const skip = new Set(['.git', 'node_modules', '.github']);
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (entry.toLowerCase().endsWith('.md')) out.push(toRel(abs));
    }
  })(ROOT);
  return out.sort();
}

// -----------------------------------------------------------------------------
// Markdown helpers
// -----------------------------------------------------------------------------

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
const BOLD_LINE_RE = /^\*\*.+\*\*:?\s*$/;

/**
 * Walk lines while tracking fenced code blocks. Yields { line, index, fenced }.
 * Template M's body is a fenced block full of `## Objective` style lines, so
 * anything that scans for headings has to know where the fences are.
 */
function* walkLines(text) {
  const lines = text.split('\n');
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      fenced = !fenced;
      yield { line, index: i, fenced: true, isFence: true };
      continue;
    }
    yield { line, index: i, fenced, isFence: false };
  }
}

/** Real ATX headings, code fences excluded. */
function headings(text) {
  const out = [];
  for (const { line, index, fenced, isFence } of walkLines(text)) {
    if (fenced || isFence) continue;
    const m = line.match(HEADING_RE);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: index + 1 });
  }
  return out;
}

/**
 * Slice the block of text a marker introduces.
 *
 * A marker is either an ATX heading (matched exactly, or as a prefix of the
 * heading text, so "## Template M" finds "## Template M - Current Claude Task
 * Brief") or a standalone bold line such as "**Adapt output format:**".
 *
 * A heading block runs until the next heading of the same or shallower depth.
 * A bold-line block runs until the next bold line or the next heading.
 * Fenced content never terminates a block.
 */
function section(text, marker) {
  const target = marker.trim();
  const rows = [...walkLines(text)];
  const isHeadingMarker = HEADING_RE.test(target);
  const markerHeadingText = isHeadingMarker ? target.match(HEADING_RE)[2].trim() : null;
  const markerLevel = isHeadingMarker ? target.match(HEADING_RE)[1].length : 0;

  let start = -1;
  // Exact match wins over prefix match, so "## Claude" cannot steal a block
  // from "## Claude Code" purely by document order.
  for (const pass of ['exact', 'prefix']) {
    for (const row of rows) {
      if (row.fenced || row.isFence) continue;
      const trimmed = row.line.trim();
      if (pass === 'exact' && trimmed === target) { start = row.index; break; }
      if (pass === 'prefix' && trimmed.startsWith(target)) { start = row.index; break; }
      if (isHeadingMarker) {
        const m = row.line.match(HEADING_RE);
        if (m && m[1].length === markerLevel) {
          if (pass === 'exact' && m[2].trim() === markerHeadingText) { start = row.index; break; }
          if (pass === 'prefix' && m[2].trim().startsWith(markerHeadingText)) { start = row.index; break; }
        }
      }
    }
    if (start !== -1) break;
  }
  if (start === -1) return null;

  let end = rows.length;
  for (const row of rows) {
    if (row.index <= start) continue;
    if (row.fenced || row.isFence) continue;
    const m = row.line.match(HEADING_RE);
    if (m && (!isHeadingMarker || m[1].length <= markerLevel)) { end = row.index; break; }
    if (!isHeadingMarker && BOLD_LINE_RE.test(row.line.trim())) { end = row.index; break; }
  }

  return {
    startLine: start + 1,
    endLine: end,
    text: rows.slice(start, end).map((r) => r.line).join('\n'),
  };
}

/**
 * GitHub's heading anchor slug: lowercase, drop everything that is not a
 * letter, digit, space, hyphen or underscore, then spaces become hyphens.
 * An em dash is dropped rather than replaced, which is why "Template A - RTF"
 * written with an em dash slugs to a DOUBLE hyphen. Derive it, never assume it.
 */
function githubSlug(headingText) {
  return headingText
    .toLowerCase()
    .replace(/[^\p{L}\p{N} \-_]/gu, '')
    .replace(/ /g, '-');
}

/** Parse a GitHub-flavoured markdown table starting at or after `fromLine`. */
function parseTable(text, fromLine) {
  const lines = text.split('\n');
  let i = fromLine;
  while (i < lines.length && !lines[i].trim().startsWith('|')) i++;
  const rows = [];
  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim().startsWith('|')) break;
    const cells = raw.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    rows.push({ cells, line: i + 1 });
  }
  if (rows.length === 0) return null;
  const header = rows[0];
  const body = rows.slice(1).filter((r) => !r.cells.every((c) => /^:?-{2,}:?$/.test(c) || c === ''));
  return { header, body };
}

function quote(s) {
  return `"${s}"`;
}

// =============================================================================
// Check 1 - version string identical everywhere it is stated
// =============================================================================

function frontmatter(text) {
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return { ok: false, error: 'no opening --- on line 1' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { close = i; break; }
  }
  if (close === -1) return { ok: false, error: 'no closing --- found' };
  const body = lines.slice(1, close);
  const pairs = [];
  const malformed = [];
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    if (line.trim() === '') continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) { malformed.push({ line: i + 2, text: line }); continue; }
    pairs.push({ key: m[1], value: m[2], line: i + 2, raw: line });
  }
  return { ok: true, pairs, malformed, closeLine: close + 1 };
}

check(1, 'Version string agrees across all four places that state it', () => {
  const skill = read('SKILL.md');
  const plugin = readJson('.claude-plugin/plugin.json');
  const market = readJson('.claude-plugin/marketplace.json');
  const readme = read('README.md');

  const found = [];

  if (skill === null) fail('SKILL.md is missing', ['expected SKILL.md at the repo root']);
  else {
    const fm = frontmatter(skill);
    const v = fm.ok ? (fm.pairs.find((p) => p.key === 'version') || {}).value : undefined;
    found.push({ where: 'SKILL.md frontmatter', value: v });
  }

  found.push({
    where: '.claude-plugin/plugin.json .version',
    value: plugin.ok ? plugin.value.version : undefined,
  });
  found.push({
    where: '.claude-plugin/marketplace.json .plugins[0].version',
    value: market.ok && Array.isArray(market.value.plugins) && market.value.plugins[0]
      ? market.value.plugins[0].version
      : undefined,
  });

  if (readme !== null) {
    // Locate the Version History section by pattern, not by a pinned heading
    // string, then take the FIRST version bullet inside it.
    const h = headings(readme).find((x) => /version\s+history/i.test(x.text));
    let v;
    let where = 'README.md Version History, first bullet';
    if (!h) {
      fail('README.md has no Version History heading', [
        'file: README.md',
        'looked for a heading matching /version history/i so the newest version bullet could be read',
      ]);
    } else {
      const sec = section(readme, `${'#'.repeat(h.level)} ${h.text}`);
      const m = sec && sec.text.match(/^\s*-\s+\*\*(\d+\.\d+\.\d+)\*\*/m);
      v = m ? m[1] : undefined;
      where = `README.md "${h.text}", first "- **X.Y.Z**" bullet`;
      if (!v) {
        fail('README.md Version History has no leading version bullet', [
          `file: README.md line ${h.line}`,
          'expected the first entry under that heading to look like: - **1.2.3** ...',
        ]);
      }
    }
    found.push({ where, value: v });
  }

  const values = found.filter((f) => f.value !== undefined).map((f) => f.value);
  const distinct = [...new Set(values)];
  if (distinct.length > 1) {
    fail('Version string disagrees between the places that state it', [
      `${distinct.length} different values are in play: ${distinct.map(quote).join(', ')}`,
      '',
      ...found.map((f) => `  ${f.value === undefined ? '(not found)' : quote(f.value)}  <- ${f.where}`),
      '',
      'All four must be bumped together, or an install will advertise a version it is not.',
    ]);
  }
});

// =============================================================================
// Check 2 - manifests parse, skill name agrees
// =============================================================================

check(2, 'Both JSON manifests parse and the skill name agrees across them', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  const market = readJson('.claude-plugin/marketplace.json');

  if (!plugin.ok) {
    fail('.claude-plugin/plugin.json does not parse as JSON', [
      'file: .claude-plugin/plugin.json',
      `parser said: ${plugin.error}`,
    ]);
  }
  if (!market.ok) {
    fail('.claude-plugin/marketplace.json does not parse as JSON', [
      'file: .claude-plugin/marketplace.json',
      `parser said: ${market.error}`,
    ]);
  }

  const names = [];
  if (plugin.ok) names.push({ where: '.claude-plugin/plugin.json .name', value: plugin.value.name });
  if (market.ok) {
    const p0 = Array.isArray(market.value.plugins) ? market.value.plugins[0] : undefined;
    if (!p0) {
      fail('.claude-plugin/marketplace.json has no plugins[0] entry', [
        'file: .claude-plugin/marketplace.json',
        'the marketplace must list at least one plugin for the skill to be installable',
      ]);
    } else {
      names.push({ where: '.claude-plugin/marketplace.json .plugins[0].name', value: p0.name });
    }
  }
  const skill = read('SKILL.md');
  if (skill !== null) {
    const fm = frontmatter(skill);
    const v = fm.ok ? (fm.pairs.find((p) => p.key === 'name') || {}).value : undefined;
    names.push({ where: 'SKILL.md frontmatter name', value: v });
  }

  const distinct = [...new Set(names.map((n) => n.value).filter((v) => v !== undefined))];
  if (distinct.length > 1) {
    fail('Skill name disagrees between the manifests and SKILL.md', [
      `values seen: ${distinct.map(quote).join(', ')}`,
      '',
      ...names.map((n) => `  ${n.value === undefined ? '(not found)' : quote(n.value)}  <- ${n.where}`),
      '',
      'A mismatch means the plugin installs under one name and the skill announces another.',
    ]);
  }
});

// =============================================================================
// Check 3 - SKILL.md frontmatter is well formed
// =============================================================================

const EXPECTED_FRONTMATTER_KEYS = ['name', 'version', 'description'];

check(3, 'SKILL.md frontmatter is well formed', () => {
  const skill = read('SKILL.md');
  if (skill === null) return;
  const fm = frontmatter(skill);
  if (!fm.ok) {
    fail('SKILL.md frontmatter block is malformed', [
      'file: SKILL.md',
      fm.error,
      'A skill without a parseable frontmatter block will not load at all.',
    ]);
    return;
  }
  if (fm.malformed.length) {
    fail('SKILL.md frontmatter has lines that are not key: value', [
      'file: SKILL.md',
      ...fm.malformed.map((m) => `  line ${m.line}: ${quote(m.text)}`),
      'Multi-line or wrapped values are the usual cause. Keep each value on one line.',
    ]);
  }
  const keys = fm.pairs.map((p) => p.key);
  const extra = keys.filter((k) => !EXPECTED_FRONTMATTER_KEYS.includes(k));
  const missing = EXPECTED_FRONTMATTER_KEYS.filter((k) => !keys.includes(k));
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (extra.length || missing.length || dupes.length) {
    fail('SKILL.md frontmatter keys are not exactly name/version/description', [
      'file: SKILL.md',
      `found: ${keys.map(quote).join(', ') || '(none)'}`,
      ...(missing.length ? [`missing: ${missing.map(quote).join(', ')}`] : []),
      ...(extra.length ? [`unexpected: ${extra.map(quote).join(', ')}`] : []),
      ...(dupes.length ? [`duplicated: ${[...new Set(dupes)].map(quote).join(', ')}`] : []),
    ]);
  }
  const desc = fm.pairs.find((p) => p.key === 'description');
  if (desc && !/^description:\s+".*"$/.test(desc.raw)) {
    fail('SKILL.md description is not a single double-quoted line', [
      'file: SKILL.md line ' + desc.line,
      `found: ${quote(desc.raw.slice(0, 120) + (desc.raw.length > 120 ? '...' : ''))}`,
      'The description must be one line wrapped in double quotes, because the loader reads it verbatim.',
    ]);
  }
});

// =============================================================================
// Check 4 - code fences balanced
// =============================================================================

check(4, 'Code fences are balanced in every markdown file', () => {
  for (const rel of markdownFiles()) {
    const text = read(rel);
    const lines = text.split('\n');
    const fenceLines = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*```/.test(lines[i])) fenceLines.push(i + 1);
    }
    if (fenceLines.length % 2 !== 0) {
      fail(`Unbalanced code fences in ${rel}`, [
        `file: ${rel}`,
        `${fenceLines.length} lines start with a triple backtick, which is odd, so one fence is never closed`,
        `fence lines: ${fenceLines.join(', ')}`,
        'An unclosed fence swallows the rest of the document when the skill is rendered.',
      ]);
    }
  }
});

// =============================================================================
// Check 5 - relative links resolve on disk
// =============================================================================

check(5, 'Every relative markdown link resolves on disk', () => {
  const linkRe = /\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const rel of markdownFiles()) {
    const text = read(rel);
    const baseDir = dirname(join(ROOT, rel));
    for (const { line, index, fenced, isFence } of walkLines(text)) {
      if (fenced || isFence) continue;
      let m;
      linkRe.lastIndex = 0;
      while ((m = linkRe.exec(line)) !== null) {
        const target = m[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, mailto:, etc.
        if (target.startsWith('#')) continue; // in-page anchor, covered by check 7
        const filePart = decodeURIComponent(target.split('#')[0]);
        if (filePart === '') continue;
        const abs = resolve(baseDir, filePart);
        if (!existsSync(abs)) {
          fail(`Broken relative link in ${rel}`, [
            `file: ${rel} line ${index + 1}`,
            `link target: ${quote(target)}`,
            `resolved against ${toRel(baseDir) || '.'}/ to a path that does not exist`,
          ]);
        }
      }
    }
  }
});

// =============================================================================
// Check 6 - Routing Index <-> tool profiles, bidirectional
// =============================================================================

/** Does profile heading `h` answer to routing label `label`? */
function headingMatchesLabel(h, label) {
  if (h === label) return true;
  for (const suffix of [' (', ' —', ' –', ' - ']) {
    if (h.startsWith(label + suffix)) return true;
  }
  return false;
}

check(6, 'Routing Index rows and tool profiles cover each other exactly', () => {
  const skill = read('SKILL.md');
  const profiles = read('references/tool-profiles.md');
  if (skill === null || profiles === null) {
    fail('Cannot run the routing check', [
      `SKILL.md: ${skill === null ? 'missing' : 'ok'}`,
      `references/tool-profiles.md: ${profiles === null ? 'missing' : 'ok'}`,
    ]);
    return;
  }

  const routingHeading = headings(skill).find((h) => /routing\s+index/i.test(h.text));
  if (!routingHeading) {
    fail('SKILL.md has no Routing Index heading', [
      'file: SKILL.md',
      'looked for a heading matching /routing index/i so the routing table could be located',
      'Without it nothing checks that the skill can find the profile it is told to read.',
    ]);
    return;
  }

  const table = parseTable(skill, routingHeading.line);
  if (!table) {
    fail('No table found under the Routing Index heading', [
      `file: SKILL.md line ${routingHeading.line}`,
    ]);
    return;
  }

  const profileCol = table.header.cells.findIndex((c) => /profile/i.test(c));
  if (profileCol === -1) {
    fail('Routing Index table has no profile column', [
      `file: SKILL.md line ${table.header.line}`,
      `header cells: ${table.header.cells.map(quote).join(', ')}`,
      'Expected one column whose header mentions "profile".',
    ]);
    return;
  }

  const rows = [];
  for (const r of table.body) {
    const cell = (r.cells[profileCol] || '').replace(/\*\*/g, '').trim();
    if (cell === '') continue;
    rows.push({ label: cell, line: r.line });
  }

  const profileHeadings = headings(profiles).filter((h) => h.level === 2);

  // Expand each routing cell into the profile labels it stands for.
  const claims = [];
  for (const row of rows) {
    const labels = ROUTING_ALIASES[row.label] || [row.label];
    for (const label of labels) claims.push({ label, cell: row.label, line: row.line });
  }

  // Direction 1: every routing cell must land on a real profile heading.
  const dangling = [];
  const claimedHeadings = new Set();
  for (const claim of claims) {
    const hits = profileHeadings.filter((h) => headingMatchesLabel(h.text, claim.label));
    if (hits.length === 0) dangling.push(claim);
    else for (const h of hits) claimedHeadings.add(h.text);
  }
  if (dangling.length) {
    fail('Routing Index points at profiles that do not exist', [
      'file: SKILL.md (Routing Index table)',
      'These "Profile to read" cells match no `## ` heading in references/tool-profiles.md:',
      '',
      ...dangling.map((d) =>
        `  line ${d.line}: ${quote(d.label)}${d.cell !== d.label ? ` (via alias for ${quote(d.cell)})` : ''}`),
      '',
      'A heading may append " (...)" or a dash suffix to the cell text and still match.',
      'If one cell should cover several profiles, add it to ROUTING_ALIASES at the top of tests/check-docs.mjs.',
      'Consequence: the skill is sent hunting for a section that does not exist and loads nothing.',
    ]);
  }

  // Direction 2: every profile heading must be claimed by at least one row.
  const orphans = profileHeadings.filter((h) => !claimedHeadings.has(h.text));
  if (orphans.length) {
    fail('Tool profiles that no Routing Index row can reach', [
      'file: references/tool-profiles.md',
      'These `## ` sections are never named by a "Profile to read" cell in SKILL.md:',
      '',
      ...orphans.map((h) => `  line ${h.line}: ${quote(h.text)}`),
      '',
      'Consequence: an orphan profile is a section the skill will never load. Either add a routing row',
      'for it, or delete the section.',
    ]);
  }
});

// =============================================================================
// Check 7 - templates: TOC, headings, letters, anchors
// =============================================================================

const TEMPLATES_FILE = 'references/templates.md';

/** Template headings, as { letter, title, fullText, line }. */
function templateHeadings() {
  const text = read(TEMPLATES_FILE);
  if (text === null) return [];
  return headings(text)
    .map((h) => {
      const m = h.text.match(/^Template\s+([A-Z])\b\s*(.*)$/);
      return m ? { letter: m[1], rest: m[2], fullText: h.text, line: h.line, level: h.level } : null;
    })
    .filter(Boolean);
}

check(7, 'Templates TOC, headings, letters and anchors agree', () => {
  const text = read(TEMPLATES_FILE);
  if (text === null) {
    fail(`${TEMPLATES_FILE} is missing`, [`expected ${TEMPLATES_FILE}`]);
    return;
  }

  const heads = templateHeadings();
  if (heads.length === 0) {
    fail('No `## Template X` headings found', [`file: ${TEMPLATES_FILE}`]);
    return;
  }

  // -- letters contiguous, no gaps, no duplicates -----------------------------
  const letters = heads.map((h) => h.letter);
  const dupes = [...new Set(letters.filter((l, i) => letters.indexOf(l) !== i))];
  if (dupes.length) {
    fail('Duplicate template letters', [
      `file: ${TEMPLATES_FILE}`,
      ...dupes.map((d) => {
        const where = heads.filter((h) => h.letter === d).map((h) => `line ${h.line}`).join(', ');
        return `  ${quote('Template ' + d)} declared at ${where}`;
      }),
    ]);
  }
  const sorted = [...new Set(letters)].sort();
  const firstCode = sorted[0].charCodeAt(0);
  const gaps = [];
  for (let i = 0; i < sorted.length; i++) {
    const expected = String.fromCharCode(firstCode + i);
    if (sorted[i] !== expected) { gaps.push(expected); break; }
  }
  if (gaps.length) {
    fail('Template letters are not contiguous', [
      `file: ${TEMPLATES_FILE}`,
      `letters present: ${sorted.join(', ')}`,
      `first gap at: ${quote('Template ' + gaps[0])}`,
      'A gap means a template was deleted without relettering, and cross-references now skip a slot.',
    ]);
  }

  // -- TOC rows ---------------------------------------------------------------
  const tocHeading = headings(text).find((h) => /table\s+of\s+contents/i.test(h.text));
  if (!tocHeading) {
    fail('No Table of Contents heading in the templates file', [
      `file: ${TEMPLATES_FILE}`,
      'looked for a heading matching /table of contents/i',
    ]);
    return;
  }
  const tocTable = parseTable(text, tocHeading.line);
  const tocEntries = [];
  if (tocTable) {
    for (const row of tocTable.body) {
      for (const cell of row.cells) {
        const m = cell.match(/^\[([^\]]+)\]\((#[^)]+)\)$/);
        if (m) { tocEntries.push({ label: m[1].trim(), anchor: m[2].trim(), line: row.line }); break; }
      }
    }
  }
  if (tocEntries.length === 0) {
    fail('Table of Contents has no template links', [
      `file: ${TEMPLATES_FILE} line ${tocHeading.line}`,
      'Expected rows shaped like: | [A - RTF](#template-a--rtf) | Best for ... |',
    ]);
    return;
  }

  // -- TOC set vs heading set -------------------------------------------------
  const tocLetters = tocEntries.map((e) => (e.label.match(/^([A-Z])\b/) || [])[1]).filter(Boolean);
  const missingFromToc = letters.filter((l) => !tocLetters.includes(l));
  const missingFromBody = tocLetters.filter((l) => !letters.includes(l));
  if (missingFromToc.length) {
    fail('Templates that exist but are not in the Table of Contents', [
      `file: ${TEMPLATES_FILE}`,
      ...missingFromToc.map((l) => {
        const h = heads.find((x) => x.letter === l);
        return `  line ${h.line}: ${quote(h.fullText)}`;
      }),
      'A template missing from the TOC is one the skill will not know to look for.',
    ]);
  }
  if (missingFromBody.length) {
    fail('Table of Contents lists templates that do not exist', [
      `file: ${TEMPLATES_FILE}`,
      ...missingFromBody.map((l) => {
        const e = tocEntries.find((x) => x.label.startsWith(l));
        return `  line ${e.line}: ${quote(e.label)} -> ${quote(e.anchor)}`;
      }),
    ]);
  }

  // -- per-entry label and anchor --------------------------------------------
  for (const entry of tocEntries) {
    const letter = (entry.label.match(/^([A-Z])\b/) || [])[1];
    const head = heads.find((h) => h.letter === letter);
    if (!head) continue;

    const expectedLabel = head.fullText.replace(/^Template\s+/, '').trim();
    if (entry.label !== expectedLabel) {
      fail(`Table of Contents text does not match the Template ${letter} heading`, [
        `file: ${TEMPLATES_FILE}`,
        `  TOC line ${entry.line}:     ${quote(entry.label)}`,
        `  heading line ${head.line}: ${quote(head.fullText)}`,
        `  expected the TOC to read ${quote(expectedLabel)}`,
      ]);
    }

    const expectedAnchor = '#' + githubSlug(head.fullText);
    if (entry.anchor !== expectedAnchor) {
      fail(`Table of Contents anchor for Template ${letter} does not match the heading slug`, [
        `file: ${TEMPLATES_FILE}`,
        `  TOC line ${entry.line} links to ${quote(entry.anchor)}`,
        `  heading line ${head.line} is ${quote(head.fullText)}`,
        `  GitHub slugs that heading to ${quote(expectedAnchor)}`,
        '  GitHub drops em dashes rather than replacing them, which is why the slug doubles a hyphen.',
      ]);
    }
  }
});

// =============================================================================
// Check 8 - every "Template X" mentioned anywhere actually exists
// =============================================================================

check(8, 'Every "Template X" mentioned in the repo names a template that exists', () => {
  const heads = templateHeadings();
  if (heads.length === 0) return;
  const known = new Set(heads.map((h) => h.letter));

  const singleRe = /\bTemplate ([A-Z])\b/g;
  const pluralRe = /\bTemplates\s+((?:[A-Z]\b)(?:\s*,?\s*(?:and\s+)?[A-Z]\b)*)/g;

  for (const rel of markdownFiles()) {
    const text = read(rel);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const mentions = [];
      let m;
      singleRe.lastIndex = 0;
      while ((m = singleRe.exec(line)) !== null) mentions.push(m[1]);
      pluralRe.lastIndex = 0;
      while ((m = pluralRe.exec(line)) !== null) {
        for (const l of m[1].split(/[^A-Z]+/).filter(Boolean)) mentions.push(l);
      }
      for (const letter of [...new Set(mentions)]) {
        if (!known.has(letter)) {
          fail(`Reference to a template that does not exist: Template ${letter}`, [
            `file: ${rel} line ${i + 1}`,
            `  ${quote(line.trim())}`,
            `templates that exist: ${[...known].sort().join(', ')}`,
            `Consequence: the skill is told to read Template ${letter} and finds nothing there.`,
          ]);
        }
      }
    }
  }
});

// =============================================================================
// Check 9 - pattern numbering and every stated pattern count
// =============================================================================

const PATTERNS_FILE = 'references/patterns.md';

check(9, 'Pattern numbering is contiguous and every stated count matches it', () => {
  const text = read(PATTERNS_FILE);
  if (text === null) {
    fail(`${PATTERNS_FILE} is missing`, [`expected ${PATTERNS_FILE}`]);
    return;
  }

  const numbers = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\|\s*(\d+)\s*\|/);
    if (m) numbers.push({ n: Number(m[1]), line: i + 1 });
  }
  if (numbers.length === 0) {
    fail('No numbered pattern rows found', [
      `file: ${PATTERNS_FILE}`,
      'Expected table rows shaped like: | 12 | **Name** | bad | fixed |',
    ]);
    return;
  }

  const seen = new Map();
  const dupes = [];
  for (const row of numbers) {
    if (seen.has(row.n)) dupes.push({ n: row.n, first: seen.get(row.n), again: row.line });
    else seen.set(row.n, row.line);
  }
  if (dupes.length) {
    fail('Duplicate pattern numbers', [
      `file: ${PATTERNS_FILE}`,
      ...dupes.map((d) => `  pattern ${d.n} appears on line ${d.first} and again on line ${d.again}`),
    ]);
  }

  const sortedNums = [...seen.keys()].sort((a, b) => a - b);
  const breaks = [];
  for (let i = 0; i < sortedNums.length; i++) {
    if (sortedNums[i] !== i + 1) { breaks.push({ expected: i + 1, found: sortedNums[i] }); break; }
  }
  if (breaks.length) {
    fail('Pattern numbering is not contiguous from 1', [
      `file: ${PATTERNS_FILE}`,
      `expected pattern ${breaks[0].expected} next, found ${breaks[0].found}`,
      `numbers present: ${sortedNums.join(', ')}`,
      'A gap means a pattern was deleted without renumbering, and every reference past the gap is off by one.',
    ]);
  }

  // Every stated count of patterns anywhere in the repo, found by pattern
  // rather than by knowing where the claims live.
  const actual = numbers.length;
  const claimRe = /\b(\d+)[ \t‐-―-]patterns?\b/gi;
  const sources = [...markdownFiles(), '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'];
  for (const rel of sources) {
    const src = read(rel);
    if (src === null) continue;
    const srcLines = src.split('\n');
    for (let i = 0; i < srcLines.length; i++) {
      let m;
      claimRe.lastIndex = 0;
      while ((m = claimRe.exec(srcLines[i])) !== null) {
        const claimed = Number(m[1]);
        if (claimed !== actual) {
          fail(`Stated pattern count does not match the table (${claimed} claimed, ${actual} actual)`, [
            `file: ${rel} line ${i + 1}`,
            `  ${quote(srcLines[i].trim())}`,
            `${PATTERNS_FILE} currently has ${actual} numbered rows.`,
            'Either the table lost a row or the prose was never updated.',
          ]);
        }
      }
    }
  }
});

// =============================================================================
// Check 10 - every vendor section in models.md carries one verification marker
// =============================================================================

const MODELS_FILE = 'references/models.md';

check(10, 'Every vendor section in models.md carries exactly one verification marker', () => {
  const text = read(MODELS_FILE);
  if (text === null) {
    fail(`${MODELS_FILE} is missing`, [`expected ${MODELS_FILE}`]);
    return;
  }

  const level2 = headings(text).filter((h) => h.level === 2);
  // The refresh-protocol section defines the marker vocabulary rather than
  // carrying a marker of its own, so it is located by pattern and skipped.
  const vendors = level2.filter((h) => !/protocol/i.test(h.text));
  if (vendors.length === 0) {
    fail('No vendor sections found in models.md', [`file: ${MODELS_FILE}`]);
    return;
  }

  // Three-state vocabulary. A two-state check reports the Evergreen section as
  // unmarked, which is a false positive, so all three forms count.
  const MARKERS = [
    { name: 'last-verified: YYYY-MM-DD', re: /last-verified:\s*\d{4}-\d{2}-\d{2}/g },
    { name: 'UNVERIFIED', re: /\bUNVERIFIED\b/g },
    { name: 'Evergreen', re: /\bEvergreen\b/g },
  ];

  for (const h of vendors) {
    const sec = section(text, `${'#'.repeat(h.level)} ${h.text}`);
    if (!sec) continue;
    const hits = [];
    for (const marker of MARKERS) {
      marker.re.lastIndex = 0;
      const found = sec.text.match(marker.re);
      if (found) for (const f of found) hits.push({ marker: marker.name, literal: f });
    }
    if (hits.length !== 1) {
      fail(
        hits.length === 0
          ? `Vendor section carries no verification marker: ${h.text}`
          : `Vendor section carries ${hits.length} verification markers: ${h.text}`,
        [
          `file: ${MODELS_FILE} line ${h.line}`,
          hits.length === 0
            ? 'Expected exactly one of: `last-verified: YYYY-MM-DD`, `UNVERIFIED`, or `Evergreen`.'
            : `found: ${hits.map((x) => quote(x.literal)).join(', ')}`,
          'An unmarked section reads as verified fact when it is not. That is what the file\'s own',
          'refresh protocol exists to prevent.',
        ],
      );
    }
  }
});

// =============================================================================
// Check 11 - rule to slot contracts, driven by tests/contracts.json
// =============================================================================

check(11, 'Every rule still has the slot it depends on (tests/contracts.json)', () => {
  const raw = readJson('tests/contracts.json');
  if (!raw.ok) {
    fail('tests/contracts.json does not parse as JSON', [
      'file: tests/contracts.json',
      `parser said: ${raw.error}`,
    ]);
    return;
  }
  const contracts = raw.value.contracts;
  if (!Array.isArray(contracts)) {
    fail('tests/contracts.json has no "contracts" array', ['file: tests/contracts.json']);
    return;
  }

  for (const contract of contracts) {
    const rule = contract.rule || '(unnamed rule)';
    const consequence = contract.consequence || 'The rule now has nowhere to land in the generated prompt.';
    for (const slot of contract.slots || []) {
      const text = read(slot.file);
      if (text === null) {
        fail(`Rule has lost its slot: ${rule}`, [
          `expected file: ${slot.file}`,
          'that file does not exist',
          '',
          `Consequence: ${consequence}`,
        ]);
        continue;
      }
      const sec = section(text, slot.section);
      if (!sec) {
        fail(`Rule has lost its slot: ${rule}`, [
          `file: ${slot.file}`,
          `missing section: ${quote(slot.section)}`,
          'The section the rule writes into is gone, most likely renamed.',
          '',
          `Consequence: ${consequence}`,
        ]);
        continue;
      }
      if (!sec.text.includes(slot.must_contain)) {
        fail(`Rule has lost its slot: ${rule}`, [
          `file: ${slot.file}`,
          `section: ${quote(slot.section)} (lines ${sec.startLine}-${sec.endLine})`,
          `missing string: ${quote(slot.must_contain)}`,
          'The section still exists but no longer carries the thing the rule depends on.',
          '',
          `Consequence: ${consequence}`,
        ]);
      }
    }
  }
});

// =============================================================================
// Check 12 - Template L: declared Decompiler tasks, output formats, Safety notes
// =============================================================================

check(12, 'Template L: every Decompiler task has an output format, every format has Safety notes', () => {
  const text = read(TEMPLATES_FILE);
  if (text === null) return;

  const templateL = templateHeadings().find((h) => /decompiler/i.test(h.fullText));
  if (!templateL) {
    fail('No Prompt Decompiler template found', [
      `file: ${TEMPLATES_FILE}`,
      'looked for a `## Template X` heading matching /decompiler/i',
    ]);
    return;
  }
  const sec = section(text, `${'#'.repeat(templateL.level)} ${templateL.fullText}`);
  if (!sec) return;

  const secLines = sec.text.split('\n');

  // Declared tasks: bold-led bullets in the "detect which task" list.
  const declared = [];
  for (let i = 0; i < secLines.length; i++) {
    const m = secLines[i].match(/^\s*[-*]\s+\*\*([^*]+)\*\*/);
    if (m) declared.push({ name: m[1].trim(), line: sec.startLine + i });
  }

  // Output formats: standalone bold lines ending in "output format:".
  const formats = [];
  for (let i = 0; i < secLines.length; i++) {
    const m = secLines[i].match(/^\*\*(.+?)\s+output format:\*\*\s*$/i);
    if (m) formats.push({ name: m[1].trim(), marker: secLines[i].trim(), line: sec.startLine + i });
  }

  if (formats.length === 0) {
    fail('Template L declares no output formats', [
      `file: ${TEMPLATES_FILE} line ${templateL.line}`,
      'Expected standalone bold lines shaped like: **Adapt output format:**',
    ]);
    return;
  }

  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

  // Every declared task needs a format.
  const withoutFormat = declared.filter((d) => !formats.some((f) => norm(f.name) === norm(d.name)));
  if (withoutFormat.length) {
    fail('Decompiler tasks declared with no output format', [
      `file: ${TEMPLATES_FILE}`,
      ...withoutFormat.map((d) => `  line ${d.line}: task ${quote(d.name)} has no ${quote(d.name + ' output format:')} block`),
      `formats present: ${formats.map((f) => quote(f.name)).join(', ')}`,
      'Consequence: that task silently falls back to another task\'s shape, so the pass is never',
      'forced to produce what the task is for.',
    ]);
  }

  // Every format needs a declared task.
  const withoutTask = formats.filter((f) => !declared.some((d) => norm(d.name) === norm(f.name)));
  if (withoutTask.length) {
    fail('Output formats with no matching Decompiler task', [
      `file: ${TEMPLATES_FILE}`,
      ...withoutTask.map((f) => `  line ${f.line}: ${quote(f.marker)} answers to no declared task`),
      `tasks declared: ${declared.map((d) => quote(d.name)).join(', ')}`,
    ]);
  }

  // Every format carries a Safety notes line.
  const SAFETY = 'Safety notes:';
  for (const f of formats) {
    const block = section(text, f.marker);
    if (!block) continue;
    if (!block.text.includes(SAFETY)) {
      fail(`Decompiler output format has no Safety notes line: ${f.name}`, [
        `file: ${TEMPLATES_FILE} line ${f.line}`,
        `section: ${quote(f.marker)} (lines ${block.startLine}-${block.endLine})`,
        `missing string: ${quote(SAFETY)}`,
        'Consequence: a Decompiler run through this format can strip a leaked API key or a live',
        'customer record and never tell the user it happened.',
      ]);
    }
  }
});

// =============================================================================
// Runner
// =============================================================================

const results = [];
for (const c of CHECKS) {
  currentCheck = c;
  const before = failures.length;
  try {
    c.fn();
  } catch (err) {
    fail(`Check crashed: ${c.name}`, [
      `${err && err.stack ? err.stack : String(err)}`,
      'This is a bug in tests/check-docs.mjs, not necessarily in the docs.',
    ]);
  }
  results.push({ ...c, failed: failures.length > before });
}
currentCheck = null;

const passed = results.filter((r) => !r.failed).length;
const failed = results.length - passed;

const out = [];
out.push('');
out.push('prompt-master structural docs check');
out.push('='.repeat(66));
out.push('');
for (const r of results) {
  out.push(`  ${r.failed ? 'FAIL' : 'pass'}  ${String(r.id).padStart(2, ' ')}. ${r.name}`);
}
out.push('');
out.push(`  ${results.length} checks run, ${passed} passed, ${failed} failed`);
out.push('');

if (failures.length) {
  out.push('-'.repeat(66));
  out.push(`${failures.length} problem${failures.length === 1 ? '' : 's'} found`);
  out.push('-'.repeat(66));
  failures.forEach((f, i) => {
    out.push('');
    out.push(`[${i + 1}/${failures.length}] check ${f.check.id} - ${f.title}`);
    for (const line of f.details) out.push(line === '' ? '' : `    ${line}`);
  });
  out.push('');
  out.push('-'.repeat(66));
  out.push('');
}

console.log(out.join('\n'));
process.exit(failed > 0 ? 1 : 0);
