declare module 'markdown-it' {
  export interface Token {
    type: string;
    tag: string;
    level: number;
    content: string;
  }

  export default class MarkdownIt {
    parse(source: string, environment: object): Token[];
  }
}
