import { parseRequirementDelta } from './schemas.js';
import type { RequirementDelta, Scenario } from './types.js';

export interface ParsedDeltaSpec { entries: RequirementDelta[] }
function body(lines: string[]): string { return lines.join('\n').trim(); }
function sectionBody(lines: string[], label: string): string | undefined {
  const index = lines.findIndex((line) => line.trim().toLocaleLowerCase() === `**${label.toLocaleLowerCase()}**`);
  if (index < 0) return undefined;
  const end = lines.findIndex((line, i) => i > index && /^\*\*(Previous|New|Reason)\*\*\s*$/iu.test(line.trim()) || /^#### Scenario:/u.test(line.trim()));
  return body(lines.slice(index + 1, end < 0 ? lines.length : end));
}
export function parseDeltaSpec(content: string): ParsedDeltaSpec {
  const lines = content.split(/\r?\n/u); const entries: RequirementDelta[] = [];
  let action: RequirementDelta['action'] | undefined; let start = 0;
  const flush = (end: number) => {
    if (!action) return;
    const block = lines.slice(start, end); const header = block.find((line) => /^###\s+MOD-\d{3}-REQ-\d{3}\b/u.test(line));
    if (!header) return;
    const match = header.match(/^###\s+(MOD-\d{3}-REQ-\d{3})\s+(.+)$/u); if (!match) return;
    const id = match[1] as RequirementDelta['id']; const module = id.split('-REQ-')[0] as RequirementDelta['module'];
    const scenarios: Scenario[] = []; const scenarioIndexes = [...block.entries()].filter(([, line]) => /^####\s+Scenario:\s*/u.test(line)).map(([i]) => i); const scenarioIds = new Set<string>();
    scenarioIndexes.forEach((i, index) => { const chunk = block.slice(i, scenarioIndexes[index + 1] ?? block.length); const header = chunk[0].replace(/^####\s+Scenario:\s*/u, '').trim(); const explicit = header.match(/^(SCN-\d{3})\s+(.+)$/u); const id = explicit?.[1] ?? header.match(/\b(SCN-\d{3})\b/u)?.[1]; if (!id) throw new Error(`Scenario in ${id ?? 'requirement'} requires an explicit stable Scenario ID`); if (scenarioIds.has(id)) throw new Error(`Duplicate Scenario ID ${id}`); scenarioIds.add(id); const name = explicit?.[2] ?? header.replace(id, '').trim(); const read = (token: string) => chunk.filter((line) => new RegExp(`\\*\\*${token}\\*\\*`, 'iu').test(line)).map((line) => line.replace(/^[-*]\s*/, '').replace(/^\*\*[^*]+\*\*\s*/, '').trim()).filter(Boolean); const given = read('GIVEN'), when = read('WHEN'), then = read('THEN'); if (!given.length || !when.length || !then.length) throw new Error(`Scenario ${id} requires GIVEN, WHEN, and THEN`); scenarios.push({ id: id as `SCN-${string}`, name, given, when, then }); });
    const previous = sectionBody(block, 'Previous'); const next = sectionBody(block, 'New'); const reason = sectionBody(block, 'Reason');
    if ((action === 'MODIFIED' || action === 'REMOVED') && !previous) throw new Error(`${action} ${id} requires Previous`);
    if ((action === 'ADDED' || action === 'MODIFIED') && !next) throw new Error(`${action} ${id} requires New`);
    if (action === 'REMOVED' && !reason) throw new Error(`REMOVED ${id} requires Reason`);
    if (!scenarios.length) throw new Error(`${action} ${id} requires at least one scenario`);
    if (action === 'MODIFIED' && !reason) throw new Error(`MODIFIED ${id} requires Reason`);
    const parsed = parseRequirementDelta({ id, module, action, previous, next, reason, scenarios }); entries.push(parsed);
  };
  for (let i = 0; i <= lines.length; i++) { const found = lines[i]?.match(/^##\s+(ADDED|MODIFIED|REMOVED)\s*$/u); if (found) { flush(i); action = found[1] as RequirementDelta['action']; start = i + 1; } } flush(lines.length);
  return { entries };
}
