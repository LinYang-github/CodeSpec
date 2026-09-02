/**
 * Shared store-selection guidance for skill template workflows.
 *
 * Interpolated into every workflow's instructions so generated skills
 * consistently teach how to target a registered store with `--store <id>`.
 */
export const STORE_SELECTION_GUIDANCE = `**Store 选择：** 如果用户指定了 store（store 是本机注册的独立 OpenSpec 仓库），或当前工作位于 store 中，请运行 \`openspec store list --json\` 查找已注册的 store ID，然后在读写 Spec 和 Change 的命令中传入 \`--store <id>\`（包括 \`new change\`、\`change new\`、\`status\`、\`instructions\`、\`list\`、\`show\`、\`validate\`、\`archive\`、\`doctor\`、\`context\`、\`schemas\`、\`view\`、\`rebase\`、\`transition\`、\`abandon\`、\`detect-stale\`、\`allocate-requirements\`）。选择后，在本次工作流的后续步骤中持续使用 \`--store <id>\`。下面未带范围的命令示例都只是简写：执行前要追加该选项。例如运行 \`openspec status --change "<name>" --json --store "<id>"\`，不要直接运行未带选项的形式。其他命令不接受该选项。命令打印的后续提示已经带有该选项，继续使用即可。没有 store 时，命令作用于最近的本地 \`openspec/\` 根目录。`;
