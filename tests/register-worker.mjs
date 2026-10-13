/**
 * Worker used by the identity test: registers a batch of Clerk users through the
 * real repository code in its own thread (and therefore its own SQLite
 * connection), which is what proves the CrowdFund User ID allocation is
 * concurrency-safe rather than merely single-process safe.
 */
import { parentPort, workerData } from "node:worker_threads";
import { ensureUserFromClerk } from "../lib/db/users.js";

const { start, count } = workerData;
const ids = [];

for (let i = 0; i < count; i += 1) {
  const index = start + i;
  const user = ensureUserFromClerk({
    clerkUserId: `user_parallel_${index}`,
    displayName: `Parallel ${index}`,
  });
  ids.push(user.cf_user_id);
}

parentPort.postMessage(ids);
