/** A choice's diamond (choice_<state>_<IF id>, as the generator names it): its state; null for any other node */
export function armState(nodeId: string): string | null {
  const m = /^choice_(.+)_(\d+)$/.exec(nodeId);
  return m ? m[1] : null;
}
