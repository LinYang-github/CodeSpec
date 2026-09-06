import { describe, expect, it } from 'vitest';
import { WELCOME_ANIMATION } from '../../src/ui/ascii-patterns.js';

describe('CodeSpec welcome animation', () => {
  it('renders an ASCII HRHY wordmark without the retired diamond art', () => {
    for (const frame of WELCOME_ANIMATION.frames) {
      expect(frame.join('\n')).toContain('HRHY');
      expect(frame.join('\n')).not.toMatch(/[█░#+]/);
    }

    expect(WELCOME_ANIMATION.frames.at(-1)?.join('\n')).toContain('H   H RRR');
  });
});
