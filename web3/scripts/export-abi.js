import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Regenerates the frontend ABI (constants/abi.js) from the compiled Hardhat
 * artifact, so the Next.js app can never drift from the deployed contract.
 *
 * Usage: npm run export-abi   (after `npx hardhat compile`)
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const artifactPath = path.resolve(
  __dirname,
  "../artifacts/contracts/CrowdfundingMarketplace.sol/CrowdfundingMarketplace.json"
);
const targetPath = path.resolve(__dirname, "../../constants/abi.js");

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const abi = artifact.abi;

const output =
  "// AUTO-GENERATED — do not edit by hand.\n" +
  "// Source: web3/artifacts/contracts/CrowdfundingMarketplace.sol/CrowdfundingMarketplace.json\n" +
  "// Regenerate with: cd web3 && npm run export-abi\n" +
  `export const CROWDFUNDING_ABI = ${JSON.stringify(abi, null, 2)};\n`;

fs.writeFileSync(targetPath, output);

console.log(
  `Exported ${abi.length} ABI entries to ${path.relative(process.cwd(), targetPath)}`
);
