/**
 * @param {import('../dist/types.js').Answer[][][]} answers
 */
export function findMultiMarkRows(answers) {
  /** @type {{ block: number, row: number, answers: import('../dist/types.js').Answer[] }[]} */
  const rows = [];

  answers.forEach((block, blockIndex) => {
    block.forEach((rowAnswers, rowIndex) => {
      if (rowAnswers.length > 1) {
        rows.push({ block: blockIndex, row: rowIndex, answers: rowAnswers });
      }
    });
  });

  return rows;
}

/**
 * @param {unknown} error
 */
export function buildErrorSuggestions(error) {
  const message = error instanceof Error ? error.message : String(error);
  const suggestions = [];

  if (/corner marker/i.test(message)) {
    suggestions.push(
      "Lower the NCC threshold to accept weaker corner matches.",
      "Try a different corner pattern if your sheet uses another marker shape.",
      "Increase the corner search margin so corners 2–4 are searched in a wider area.",
      "Add or adjust detection scales if corners appear larger or smaller than expected.",
    );
  }

  if (/homography|perspective|warp/i.test(message)) {
    suggestions.push(
      "Corner positions may be wrong — verify corner detection settings first.",
      "Try lowering the NCC threshold or changing the corner pattern.",
    );
  }

  if (/threshold|fill|ncc/i.test(message) && suggestions.length === 0) {
    suggestions.push(
      "Adjust the fill threshold if bubbles are detected too aggressively or not at all.",
      "Adjust the NCC threshold if corner matching is too strict or too loose.",
    );
  }

  if (suggestions.length === 0) {
    suggestions.push(
      "Review the sheet layout values (start positions, bubble size, gaps).",
      "Enable debug output to inspect the warped grid overlay.",
      "Try increasing exposure gamma for dark or low-contrast scans.",
    );
  }

  return { message, suggestions };
}

/**
 * @param {import('../dist/types.js').Answer[][][]} answers
 */
export function buildResultWarnings(answers) {
  const multiMarkRows = findMultiMarkRows(answers);
  if (multiMarkRows.length === 0) return null;

  const warnings = [
    "Some rows have multiple marked bubbles. Try increasing the fill threshold so only darker marks count.",
    "If marks look faint or bleed into neighbors, increase exposure gamma to improve contrast.",
    "Use the debug grid overlay to confirm cell rectangles align with the printed bubbles.",
  ];

  const details = multiMarkRows
    .slice(0, 5)
    .map(
      ({ block, row, answers: rowAnswers }) =>
        `Block ${block + 1}, row ${row + 1}: ${rowAnswers.join(", ")}`,
    );

  if (multiMarkRows.length > 5) {
    details.push(`…and ${multiMarkRows.length - 5} more row(s).`);
  }

  return { warnings, details };
}
