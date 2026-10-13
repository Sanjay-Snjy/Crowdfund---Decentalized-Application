#!/usr/bin/env node
/**
 * Grant or revoke the CrowdFund `admin` role.
 *
 * The role lives in the database and is the ONLY thing that authorizes the
 * /api/admin/* routes. There is deliberately no API endpoint that sets a role, so
 * a user can never promote themselves — promotion happens here (or through the
 * CF_ADMIN_* allow-list, which a signed sign-in applies automatically).
 *
 * Usage (from the project root):
 *
 *   node scripts/grant-admin.mjs --wallet 0xAbC…            # grant by wallet
 *   node scripts/grant-admin.mjs --cf CF-0002 --revoke      # revoke by CrowdFund ID
 *   node scripts/grant-admin.mjs --clerk user_2abc…         # grant by Clerk user id
 *   node scripts/grant-admin.mjs --list                     # show administrators
 *
 * Uses the same database as the app (CF_DATABASE_PATH, default data/crowdfund.db).
 */
import { db } from "../lib/db/index.js";

function parseArgs(argv) {
  const args = { revoke: false, list: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case "--wallet":
        args.wallet = argv[++i];
        break;
      case "--clerk":
        args.clerk = argv[++i];
        break;
      case "--cf":
        args.cf = argv[++i];
        break;
      case "--revoke":
        args.revoke = true;
        break;
      case "--list":
        args.list = true;
        break;
      default:
        if (token.startsWith("--")) {
          console.error(`Unknown option: ${token}`);
          process.exit(2);
        }
    }
  }
  return args;
}

function printUser(user) {
  console.log(
    [
      user.cf_user_id,
      user.role === "admin" ? "admin" : "user ",
      user.display_name || "—",
      user.wallet_address || "no wallet",
      user.clerk_user_id || "no clerk id",
    ].join("  |  ")
  );
}

const args = parseArgs(process.argv);
const databaseFile = db.init();

if (args.list) {
  const rows = db.driver.query(
    `SELECT cf_user_id, role, display_name, wallet_address, clerk_user_id
       FROM users WHERE role = 'admin' ORDER BY cf_seq ASC`
  );
  console.log(`Administrators in ${databaseFile}:`);
  if (rows.length === 0) console.log("  (none)");
  rows.forEach(printUser);
  process.exit(0);
}

let user = null;

if (args.wallet) {
  const address = db.users.normalizeWalletAddress(args.wallet);
  if (!address) {
    console.error("Invalid wallet address");
    process.exit(2);
  }
  user =
    db.users.getUserByWallet(address) ||
    db.users.ensureUserFromWallet({ address, displayName: `Wallet ${address.slice(0, 6)}` });
} else if (args.clerk) {
  user = db.users.getUserByClerkId(args.clerk);
  if (!user) {
    console.error(`No CrowdFund profile is linked to Clerk user ${args.clerk} yet.`);
    console.error("The profile is created by the Clerk webhook or the user's first signed-in request.");
    process.exit(1);
  }
} else if (args.cf) {
  user = db.users.getUserByCfUserId(args.cf);
  if (!user) {
    console.error(`No user with CrowdFund User ID ${args.cf}`);
    process.exit(1);
  }
} else {
  console.error("Provide --wallet <0x…>, --clerk <user_id> or --cf <CF-0001> (or --list).");
  process.exit(2);
}

const updated = db.users.setUserRole(user.id, args.revoke ? "user" : "admin");
db.driver.run(
  `INSERT INTO admin_audit (actor, action, subject, detail, created_at) VALUES (?, ?, ?, ?, ?)`,
  [
    "cli",
    args.revoke ? "role.revoke" : "role.grant",
    user.cf_user_id,
    args.wallet ? `wallet:${user.wallet_address}` : null,
    Math.floor(Date.now() / 1000),
  ]
);

console.log(`${args.revoke ? "Revoked" : "Granted"} admin for ${updated.cf_user_id} (${updated.display_name || "no name"}).`);
console.log(`Database: ${databaseFile}`);
