import { uuidv7 } from "@/lib/ids";

/**
 * This tab's identity on a list.
 *
 * There are no accounts, so without this every write went out with no author:
 * `checkedBy` stayed empty, last-write-wins tie-breaks compared empty strings,
 * and a device could never recognise the echo of its own change.
 *
 * Scoped to the tab (sessionStorage) rather than the device. Echoes carrying
 * this id are dropped, so two tabs sharing one id would silently ignore each
 * other's edits. It still survives a reload, which is when it matters.
 */
const memoryFallback = new Map<string, string>();

export function tabMemberId(token: string): string {
  const key = `ostoslista:member:${token}`;
  try {
    const stored = window.sessionStorage.getItem(key);
    if (stored) return stored;
    const created = uuidv7();
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    // Storage blocked (private mode, sandboxed preview): one id per page load.
    let id = memoryFallback.get(key);
    if (!id) {
      id = uuidv7();
      memoryFallback.set(key, id);
    }
    return id;
  }
}
