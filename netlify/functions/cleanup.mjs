// Daily clean-up: delete usage counters older than two days and expired sessions.
import { getStore } from "@netlify/blobs";

export const config = { schedule: "@daily" };

export default async () => {
  const cutoff = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 13);
  const counters = getStore({ name: "counters", consistency: "strong" });
  const { blobs: counterBlobs } = await counters.list();
  let removed = 0;
  for (const { key } of counterBlobs) {
    // Keys start with a date or hour ("2026-09-25/…", "fail/2026-09-25T10/…", "signup/2026-09-25/…").
    const stamp = key.match(/\d{4}-\d{2}-\d{2}(T\d{2})?/)?.[0];
    if (stamp && stamp < cutoff.slice(0, stamp.length)) { await counters.delete(key); removed++; }
  }

  const sessions = getStore({ name: "sessions", consistency: "strong" });
  const { blobs: sessionBlobs } = await sessions.list();
  const now = Date.now();
  for (const { key } of sessionBlobs) {
    const s = await sessions.get(key, { type: "json" });
    if (!s || s.expires < now) { await sessions.delete(key); removed++; }
  }
  console.log(`cleanup removed ${removed} entries`);
};
