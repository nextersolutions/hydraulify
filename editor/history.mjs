// Undo and redo, as a stack of whole models.
//
// A circuit model is a few kilobytes, so storing each state whole is cheaper
// than getting inverse operations right for every edit. States are kept as
// JSON strings, so nothing the page later mutates can reach back into history.

export function createHistory(model, { limit = 200 } = {}) {
  let past = [];
  let present = JSON.stringify(model);
  let future = [];

  return {
    get current() {
      return JSON.parse(present);
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    /** Record a new state. A state identical to the current one is not an edit. */
    push(next) {
      const serialized = JSON.stringify(next);
      if (serialized === present) return false;
      past.push(present);
      if (past.length > limit) past = past.slice(past.length - limit);
      present = serialized;
      future = [];
      return true;
    },
    undo() {
      if (!past.length) return null;
      future.push(present);
      present = past.pop();
      return JSON.parse(present);
    },
    redo() {
      if (!future.length) return null;
      past.push(present);
      present = future.pop();
      return JSON.parse(present);
    },
    /** Start over from a model, as after opening a different file. */
    reset(model) {
      past = [];
      future = [];
      present = JSON.stringify(model);
    },
  };
}
