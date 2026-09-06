/**
 * ASCII wordmark animation patterns for the welcome screen.
 *
 * The product mark is deliberately plain ASCII so it renders consistently in
 * every terminal and does not inherit the retired diamond animation.
 */

const HRHY_WORDMARK = [
  'H   H RRR  H   H Y   Y',
  'H   H R  R H   H  Y Y ',
  'HHHHH RRR  HHHHH   Y  ',
  'H   H R R  H   H   Y  ',
  'H   H R  R H   H   Y  ',
];

/**
 * Welcome animation frames. Every frame keeps the textual HRHY identity
 * visible while progressively revealing the five-line wordmark.
 */
export const WELCOME_ANIMATION = {
  interval: 120,
  frames: Array.from({ length: HRHY_WORDMARK.length }, (_, visibleLines) => [
    'HRHY',
    ...HRHY_WORDMARK.map((line, index) => (index <= visibleLines ? line : '')),
  ]),
};
