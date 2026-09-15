declare module 'markdown-it' {
  export interface Token {
    type: string;
    tag: string;
    level: number;
    content: string;
    nesting: -1 | 0 | 1;
    map: [number, number] | null;
    children: Token[] | null;
  }

  export default class MarkdownIt {
    constructor(options?: { html?: boolean });
    parse(source: string, environment: object): Token[];
    renderInline(source: string): string;
  }
}
