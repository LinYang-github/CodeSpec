import * as fs from 'node:fs/promises';
import path from 'node:path';

/** Rejects lexical escape and every existing symlink from target through root. */
export async function assertPathWithoutSymlinks(root: string, target: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`路径越出 CodeSpec 工作区：${target}`);
  let cursor = resolvedTarget;
  while (true) {
    const stat = await fs.lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error(`CodeSpec 路径不得包含软链接：${cursor}`);
    if (cursor === resolvedRoot) return;
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`路径越出 CodeSpec 工作区：${target}`);
    cursor = parent;
  }
}
