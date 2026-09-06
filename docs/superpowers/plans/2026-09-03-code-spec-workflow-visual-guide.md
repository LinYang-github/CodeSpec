# CodeSpec Workflow Visual Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成一张适合团队/客户投屏的 CodeSpec 工作流图，并导出 SVG 与 PNG。

**Architecture:** 使用单张宽版 SVG 表达从初始化、`workflow`、实现验证到 `archive` 的主线；将 `rebase` 作为橙色异常分支，将三个公开 Skill 作为职责卡，将 Change 目录及六个 canonical 产物作为底部产物区。PNG 由 SVG 通过 Fireworks 技术图工具链导出，完成 XML、几何和视觉复核。

**Tech Stack:** 手写 SVG、Fireworks Tech Graph `validate-svg.sh`、CairoSVG/工具链 PNG 导出。

**Spec:** `docs/superpowers/specs/2026-09-03-code-spec-workflow-visual-guide-design.md`

## Global Constraints

- 成品面向投屏，使用宽版画布、高对比度文字和清晰的单向阅读路径。
- 文字使用中文；命令名、路径、Skill 名、ID、状态和 schema token 保持英文。
- 主线依次表达 `openspec init` → `/opsx:workflow` → Change 产物 → 实现与验证 → 人工确认 `/opsx:archive`。
- 仅保留三个公开 Skill：`openspec-workflow`、`openspec-rebase-change`、`openspec-archive-change`。
- 明确表达 Core 负责领域治理/事务，Superpowers 负责工程方法；`propose / apply / verify / sync` 不作为独立公开 Skill。
- 明确表达 `spec-driven` / open-driven 是按 Schema 组合产物的通用方式，`code-spec` 是面向日常编码和 AI 协作的默认协议。
- 逐项描述 `metadata.yaml`、`proposal.md`、`design.md`、`spec.md`、`tasks.md`、`verification.md` 的用途。
- 只输出 `assets/codespec-workflow-guide.svg` 和 `assets/codespec-workflow-guide.png`；不生成讲解稿。

---

### Task 1: Define the final diagram composition

**Files:**
- Read: `docs/superpowers/specs/2026-09-03-code-spec-workflow-visual-guide-design.md`
- Read: `/Users/wanglinan/.codex/skills/fireworks-tech-graph-main/references/composition-quality-contract.md`
- Read: `/Users/wanglinan/.codex/skills/fireworks-tech-graph-main/references/style-1-flat-icon.md`
- Read: `/Users/wanglinan/.codex/skills/fireworks-tech-graph-main/references/png-export.md`

**Interfaces:**
- Consumes: the approved visual design and current CodeSpec terminology in `docs/overview.md` and `docs/workflows.md`.
- Produces: a fixed canvas/grid plan for Task 2: title band; four-step main journey; three Skill cards; comparison strip; artifact tree; legend.

- [ ] **Step 1: Freeze the reading order and copy budget**

  Use a 1800×1280 canvas. Keep the title and one-sentence promise at the top; use the center as the main story; put the comparison and artifact details below the story. Keep each process card to one title plus at most three short explanatory lines.

- [ ] **Step 2: Assign visual semantics**

  Use blue for user/input and the main journey, purple for `workflow` orchestration, amber/orange dashed lines for `STALE`/conflict recovery, and green for archive/Current Specification. Every arrow must have a visible semantic label or be explained by the legend.

- [ ] **Step 3: Check content coverage against the approved spec**

  Confirm the canvas has visible copy for the three entry duties, the Core/Superpowers split, the `spec-driven`/open-driven comparison, all six Change artifacts, `GIVEN / WHEN / THEN / ERROR`, and the two archive destinations.

### Task 2: Create the SVG source

**Files:**
- Create: `assets/codespec-workflow-guide.svg`

**Interfaces:**
- Consumes: Task 1 canvas/grid plan and repository terminology.
- Produces: a self-contained SVG with `role="img"`, title/description metadata, accessible text, marker definitions, no external assets, and clearly separated semantic groups.

- [ ] **Step 1: Add the self-contained SVG scaffold**

  Define the canvas, background, typography, color tokens, arrow markers, and panel containers. Use `data-graph-role="container|edge|node"` attributes where useful for validation and future inspection.

- [ ] **Step 2: Add the “从 0 开始怎么用” main journey**

  Draw four numbered steps: `1 描述需求`, `2 workflow 创建 Change`, `3 编码与验证`, `4 人工确认归档`. Show `openspec init` before the journey and `/opsx:workflow <what-you-want-to-build>` at the first entry. Add the `STALE / 冲突 → rebase → workflow` side route without crossing node interiors.

- [ ] **Step 3: Add the three Skill responsibility cards and boundary statement**

  Give each public Skill one card with usage condition and outcome. Add the sentence that Core owns Change/Requirement/Baseline/STALE/Traceability/archive transaction while Superpowers owns brainstorming/planning/TDD/debugging/verification/review. Add the reason for consolidation in plain Chinese.

- [ ] **Step 4: Add the open-driven/spec-driven comparison**

  Use a compact two-column comparison with rows for “核心视角、入口、工作单元、规则中心、迭代方式、规格落点”. Avoid claiming that one is universally better; describe `code-spec` as the default protocol for coding and the other as an explicit generic Schema route.

- [ ] **Step 5: Add the Change artifact tree and archive destinations**

  Show `openspec/changes/CHG-YYYYMMDD-NNN/` and list the six files with one-line meanings. Draw the final arrow to `openspec/archive/specs/` and `openspec/archive/changes/`, with a note that only archive transaction updates Current Specification.

- [ ] **Step 6: Add the legend and final emphasis**

  Add a three-color flow legend and a bottom takeaway: “正常开发只从 workflow 开始；异常才 rebase；完成后才 archive。”

### Task 3: Validate and export the image files

**Files:**
- Modify: `assets/codespec-workflow-guide.svg` only if validation or visual inspection finds a defect.
- Create: `assets/codespec-workflow-guide.png`

**Interfaces:**
- Consumes: `assets/codespec-workflow-guide.svg`.
- Produces: geometry-checked SVG and a readable PNG export at the same aspect ratio.

- [ ] **Step 1: Run SVG validation**

  Run:

  ```bash
  SKILL_ROOT="/Users/wanglinan/.codex/skills/fireworks-tech-graph-main"
  "$SKILL_ROOT/scripts/validate-svg.sh" assets/codespec-workflow-guide.svg
  ```

  Expected: XML, markers, geometry, composition, and renderability checks pass with exit code 0.

- [ ] **Step 2: Export PNG**

  Run the Fireworks diagram export helper with the validated SVG, producing `assets/codespec-workflow-guide.png` at a presentation-friendly resolution.

- [ ] **Step 3: Inspect the exported PNG**

  Load the PNG back and confirm: no cropped title or footer, no overlapping text, no arrow through a card, no unreadable comparison rows, and no artifact names missing from the bottom tree.

- [ ] **Step 4: Re-run validation after any visual correction**

  If inspection finds a layout defect, edit the SVG, repeat validation, re-export PNG, and inspect again until both files represent the same final layout.

### Task 4: Final handoff

**Files:**
- Verify: `assets/codespec-workflow-guide.svg`
- Verify: `assets/codespec-workflow-guide.png`

**Interfaces:**
- Consumes: validated final diagram files from Task 3.
- Produces: concise handoff with clickable absolute file links and the verification result.

- [ ] **Step 1: Check repository diff scope**

  Confirm only the two requested image files are new/modified for this output; do not include `.superpowers/brainstorm/` session files in the deliverable.

- [ ] **Step 2: Report the files and visual content**

  Link both assets, summarize the four-step main path, the three Skill cards, the comparison, and the six artifacts in one short paragraph.
