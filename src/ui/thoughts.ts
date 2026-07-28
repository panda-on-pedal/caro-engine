import type { SearchProgressEvent } from "../engine/search/searchProgress.ts";
import type { PracticeReportEvent } from "../shared/practiceReport.ts";

/** English-only thought templates. Intentional: not routed through i18n. */
export function formatThought(event: SearchProgressEvent): string {
  switch (event.type) {
    case "phase":
      if (event.phase === "scanning") {
        return "Looking over the board…";
      }
      if (event.phase === "quiet") {
        return "This looks quiet…";
      }
      return "Searching interesting lines…";
    case "candidates":
      return `I see about ${event.count} interesting spots…`;
    case "examining":
      return `Let me check ${event.row},${event.col}…`;
    case "insight":
      return formatInsight(event.row, event.col, event.kind);
    case "bestSoFar":
      return `${event.row},${event.col} looks strongest so far…`;
    case "deeper":
      return "Looking a bit deeper…";
    case "experienceHit":
      return `I remember this spot, ${event.row},${event.col} (depth ${event.depth})…`;
    case "pvFollowHit":
      return `Still on my line, ${event.row},${event.col} (depth ${event.depth})…`;
    case "searchStats":
      return `Depth ${event.depth} · ${event.nodes.toLocaleString("en-US")} nodes…`;
  }
}

export function formatReportLine(ev: PracticeReportEvent): string {
  const score = ev.newScore >= 0 ? `+${ev.newScore}` : `${ev.newScore}`;
  const depth =
    ev.oldDepth === null || ev.oldDepth === ev.newDepth
      ? `d${ev.newDepth}`
      : `d${ev.oldDepth}→d${ev.newDepth}`;
  const moved = ev.moveChanged ? " · move changed" : "";
  switch (ev.kind) {
    case "new":
      return `Learned a new spot, ${score} · ${depth} · L${ev.settleLevel}…`;
    case "improved":
      return `Improved, ${score} · ${depth} · L${ev.settleLevel}${moved}…`;
    case "stalled":
      return `No gain, ${depth} · give up ${ev.stallCount}/${ev.giveUp}…`;
    case "settled":
      return `Settled (frozen), ${score} · ${depth} · L${ev.settleLevel}…`;
  }
}

function formatInsight(row: number, col: number, kind: string): string {
  const cell = `${row},${col}`;
  switch (kind) {
    case "win":
      return `Hmm, ${cell} looks like a win…`;
    case "open-four":
      return `Hmm, ${cell} could build an open-four…`;
    case "four":
      return `Hmm, ${cell} could build a four…`;
    case "open-three":
      return `Hmm, ${cell} could build an open-three…`;
    case "fork":
      return `Hmm, ${cell} looks like a fork…`;
    case "block":
      return `Hmm, ${cell} might need blocking…`;
    default:
      return `Hmm, ${cell} is interesting…`;
  }
}
