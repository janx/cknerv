/**
 * What the composing chapter of the boot band says, and how much of it is a
 * measurement. Beside the banner for the same reason `bootSequencePresentation`
 * sits beside its own: `boot/stageCompose.ts` decides WHEN the chapter exists
 * and reads no colours, no words and no formats.
 */

/** The band's title while the stage composes. Deliberately the same first word
 *  as `STAGE POWER-ON`: one instrument, successive chapters, and the word that
 *  changes is the one that says what it is doing now. */
export const STAGE_COMPOSING_TITLE = 'STAGE COMPOSING';

const fmt = (n: number) => n.toLocaleString('en-US');

export interface StageComposingLine {
  /** The trail beside the title. */
  text: string;
  /**
   * The fraction the band's edge draws, or null for indeterminate.
   *
   * There is exactly one moment in this chapter with an honest denominator:
   * while seats are still being filled, `staged / budget` is two measured
   * numbers and the budget really is the target. After that the seat count is
   * pinned at the budget for the whole of the composition's own work, and a
   * bar drawn from it would sit at 100% through every second of it — which is
   * precisely the reading that made the previous readout worse than nothing.
   *
   * The curated share has no published target to divide by (the tip window
   * legitimately keeps canonical seats, and a class the chain cannot supply
   * leaves a permanent shortfall), so it is reported as a count and the edge
   * stays dark. Same rule the snapshot phase follows without a content-length:
   * show what was measured, never a synthesized denominator.
   */
  fill: number | null;
}

/**
 * One line for three movements — filling, landing, converging — because they
 * are one fact to a reader: the world on screen is not the world yet.
 */
export function stageComposingLine(input: {
  staged: number | null;
  budget: number | null;
  curated: number | null;
  composed: boolean;
}): StageComposingLine | null {
  const { staged, budget, curated, composed } = input;
  if (staged === null || budget === null || budget <= 0) return null;

  const seats = `STAGED ${fmt(staged)}`;
  if (staged < budget) {
    return {
      text: `${seats} / ${fmt(budget)}`,
      fill: Math.max(0, Math.min(1, staged / budget)),
    };
  }
  if (!composed) {
    // Full, and every seat is canonical fill: the server has stood the stage
    // up out of what it had while its composition is still coming. Naming that
    // is the difference between a page that looks finished and one that says
    // what it is showing.
    return { text: `AWAITING COMPOSITION · ${seats}`, fill: null };
  }
  return { text: `CURATED ${fmt(curated ?? 0)} · ${seats}`, fill: null };
}
