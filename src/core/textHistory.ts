export interface TextHistory {
  past: string[];
  present: string;
  future: string[];
}

const DEFAULT_LIMIT = 100;

export function createTextHistory(initial: string): TextHistory {
  return {
    past: [],
    present: initial,
    future: [],
  };
}

export function pushTextHistory(
  history: TextHistory,
  next: string,
  limit = DEFAULT_LIMIT,
): TextHistory {
  if (next === history.present) return history;

  const past = [...history.past, history.present].slice(-Math.max(1, limit));

  return {
    past,
    present: next,
    future: [],
  };
}

export function undoTextHistory(history: TextHistory): TextHistory {
  const previous = history.past.at(-1);
  if (previous == null) return history;

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoTextHistory(history: TextHistory): TextHistory {
  const next = history.future[0];
  if (next == null) return history;

  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

export function canUndoTextHistory(history: TextHistory): boolean {
  return history.past.length > 0;
}

export function canRedoTextHistory(history: TextHistory): boolean {
  return history.future.length > 0;
}
