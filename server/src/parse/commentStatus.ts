import type { Status } from "../api/dto.js";
import { labelOf } from "./normalize.js";

/** Whole labels only. Consume longer labels before their nested shorter labels. */
export function commentStatus(
  note: string,
  map: Record<string, Status>,
  wfmStatus: Status = "Unknown",
) {
  if (!note.trim()) return { label: null, status: null, explained: false };
  let remaining = labelOf(note);
  const found = new Set<string>();
  for (const label of Object.keys(map).sort((a, b) => b.length - a.length)) {
    if (!label || map[label] === "Unknown") continue;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
      "gu",
    );
    remaining = remaining.replace(match, () => {
      if (map[label] !== wfmStatus) found.add(label);
      return " ";
    });
  }
  const label = found.size === 1 ? [...found][0] : null;
  return {
    label,
    status: label ? map[label] : null,
    explained: found.size !== 1,
    ...(found.size > 1 ? { ambiguous: true } : {}),
  };
}
