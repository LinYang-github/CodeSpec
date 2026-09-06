import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_BUDGET,
  getOnboardingCommands,
} from '../../src/core/onboarding-commands.js';
import { ALL_WORKFLOWS, CORE_WORKFLOWS } from '../../src/core/profiles.js';

describe('getOnboardingCommands', () => {
  it('omits commands the profile does not install', () => {
    const commands = getOnboardingCommands(CORE_WORKFLOWS).map((c) => c.command);

    expect(commands).toEqual(['/codespec:workflow', '/codespec:archive']);
    expect(commands).not.toContain('/codespec:new');
    expect(commands).not.toContain('/codespec:continue');
  });

  it('includes expanded commands when a custom profile installs them', () => {
    const commands = getOnboardingCommands(['new', 'continue', 'apply']).map((c) => c.command);

    expect(commands).toEqual(['/codespec:workflow']);
  });

  it('returns lifecycle order regardless of the order workflows are given', () => {
    const commands = getOnboardingCommands(['apply', 'continue', 'propose']).map((c) => c.command);

    expect(commands).toEqual(['/codespec:workflow']);
  });

  it('returns nothing when no onboarding workflow is installed', () => {
    expect(getOnboardingCommands(['unknown'])).toEqual([]);
    expect(getOnboardingCommands([])).toEqual([]);
  });

  it('keeps descriptions within the welcome screen width budget', () => {
    // A longer description wraps the welcome screen at 60 columns, which desyncs
    // its animation. See the width test in test/ui/welcome-screen.test.ts.
    for (const { command, description } of getOnboardingCommands(ALL_WORKFLOWS)) {
      expect(description.length, `${command} description is too long`).toBeLessThanOrEqual(
        DESCRIPTION_BUDGET
      );
    }
  });
});
