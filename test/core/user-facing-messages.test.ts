import { describe, expect, it } from 'vitest';
import { formatDiagnosticMessage, formatStatusLabel } from '../../src/ui/user-facing-messages.js';

describe('user-facing messages', () => {
  it('formats lifecycle statuses with Chinese labels and stable protocol values', () => {
    expect(formatStatusLabel('ANALYZE')).toBe('分析（ANALYZE）');
    expect(formatStatusLabel('ARCHIVED')).toBe('已归档（ARCHIVED）');
  });

  it('localizes known diagnostic categories without changing their codes', () => {
    expect(formatDiagnosticMessage('command_error', 'example')).toContain('命令执行失败');
    expect(formatDiagnosticMessage('change_required', 'missing')).toContain('必须指定 Change');
  });
});
