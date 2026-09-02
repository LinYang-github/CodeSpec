import type { ChangeStatus } from '../core/openspec-workflow/types.js';

const STATUS_LABELS: Record<ChangeStatus, string> = {
  ANALYZE: '分析（ANALYZE）',
  DESIGN: '设计（DESIGN）',
  PLAN: '计划（PLAN）',
  IMPLEMENT: '实现（IMPLEMENT）',
  VERIFY: '验证（VERIFY）',
  ARCHIVE: '归档（ARCHIVE）',
  ARCHIVED: '已归档（ARCHIVED）',
  ABANDONED: '已放弃（ABANDONED）',
};

/** Format a protocol status for people without changing the serialized value. */
export function formatStatusLabel(status: ChangeStatus | string | unknown): string {
  if (typeof status !== 'string') return String(status);
  return STATUS_LABELS[status as ChangeStatus] ?? status;
}

/** Keep diagnostic codes and protocol values stable while localizing labels. */
export function formatDiagnosticMessage(code: string, message: string): string {
  if (/[\u4e00-\u9fff]/u.test(message)) return message;
  const known: Record<string, string> = {
    command_error: '命令执行失败',
    change_error: 'Change 处理失败',
    change_required: '必须指定 Change',
    legacy_change_unsupported: '当前 canonical workspace 不支持旧 Change 标识',
    no_openspec_root: '当前目录及其父目录中未找到 OpenSpec 根目录',
    no_root_with_registered_stores: '当前目录及其父目录中未找到 OpenSpec 根目录',
    unknown_store: '未找到指定的 store',
    no_registered_stores: '当前没有已注册的 store',
    invalid_store_pointer: 'store 指针无效',
    unhealthy_store_root: 'OpenSpec store 根目录不完整',
  };
  const prefix = known[code];
  return prefix ? `${prefix}：${message}` : message;
}
