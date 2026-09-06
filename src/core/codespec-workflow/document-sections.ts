import { buildCodeFenceMask } from '../parsers/code-fence.js';

/** Only real level-two headings delimit sections; headings inside examples are data. */
export function documentSections(content: string): Array<{ title: string; body: string; raw: string }> {
  const lines = content.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').split('\n');
  const mask = buildCodeFenceMask(lines);
  const headings = lines.flatMap((line, index) => {
    const match = !mask[index] && /^##[ \t]+(.+?)[ \t]*$/u.exec(line);
    return match ? [{ title: match[1], index }] : [];
  });
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.index ?? lines.length;
    return {
      title: heading.title,
      body: lines.slice(heading.index + 1, end).join('\n'),
      raw: lines.slice(heading.index, end).join('\n'),
    };
  });
}

export const INLINE_DESIGN_SECTIONS = new Set(['设计说明', 'SDD 分级依据', '归档影响分析']);
