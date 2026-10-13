import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Regenerates the frontend ABI (constants/abi.js) from the compiled Hardhat
 * artifact, so the Next.js app can never drift from the contract it was built for.
 *
 * Usage: npm run export-abi   (after `npx hardhat compile`)
 *
 * IMPORTANT — the ABI must match the DEPLOYED contract, not just the sources.
 * If the Solidity sources changed but the contract at
 * constants/index.js → COMMITTED_CONTRACT_ADDRESS was not redeployed yet, this
 * export makes the frontend decode structs with the wrong layout (reads revert
 * with errors such as "Hex value … is not a valid boolean"). The script therefore
 * prints a loud warning whenever the exported ABI differs from the one currently
 * in use.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const artifactPath = path.resolve(
  __dirname,
  "../artifacts/contracts/CrowdfundingMarketplace.sol/CrowdfundingMarketplace.json"
);
const targetPath = path.resolve(__dirname, "../../constants/abi.js");

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const abi = artifact.abi;

const previous = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : "";

const output =
  "// AUTO-GENERATED — do not edit by hand.\n" +
  "// Source: web3/artifacts/contracts/CrowdfundingMarketplace.sol/CrowdfundingMarketplace.json\n" +
  "// Regenerate with: cd web3 && npm run export-abi\n" +
  "// NOTE: this ABI must match the DEPLOYED contract (constants/index.js →\n" +
  "// COMMITTED_CONTRACT_ADDRESS). Redeploy first, then update the address and run\n" +
  "// this export, otherwise struct reads decode with the wrong field layout.\n" +
  `export const CROWDFUNDING_ABI = ${JSON.stringify(abi, null, 2)};\n`;

fs.writeFileSync(targetPath, output);

const changed = previous.trim() !== output.trim();

console.log(
  `Exported ${abi.length} ABI entries to ${path.relative(process.cwd(), targetPath)}`
);

if (changed) {
  console.log(
    [
      "",
      "  ⚠ The exported ABI DIFFERS from the one that was in constants/abi.js.",
      "    The frontend decodes contract data with this ABI, so it must point at a",
      "    contract deployed from these sources:",
      "      1) npx hardhat run scripts/deploy.js --network sepolia",
      "      2) update COMMITTED_CONTRACT_ADDRESS in constants/index.js",
      "      3) update NEXT_PUBLIC_CONTRACT_ADDRESS_OVERRIDE / redeploy the frontend",
      "    Until then, keep the previous ABI (git checkout -- constants/abi.js).",
      "",
    ].join("\n")
  );
}
