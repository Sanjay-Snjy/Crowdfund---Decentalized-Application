/**
 * Campaign metadata cache.
 *
 * Campaign state is owned by the smart contract; this table only caches the
 * fields the UI/server needs for labels, search and faster lists. It is always
 * refreshed from chain state, never treated as the source of truth.
 */
import { getRow, query, run } from "./driver.js";

export function upsertCampaign(campaign) {
  const chainId = Number(campaign.chainId);
  const contractAddress = String(campaign.contractAddress).toLowerCase();
  const campaignId = Number(campaign.campaignId);

  run(
    `INSERT INTO campaign_cache
       (chain_id, contract_address, campaign_id, title, creator, target_amount, raised_amount,
        deadline, completed, active, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (chain_id, contract_address, campaign_id) DO UPDATE SET
        title          = excluded.title,
        creator        = excluded.creator,
        target_amount  = excluded.target_amount,
        raised_amount  = excluded.raised_amount,
        deadline       = excluded.deadline,
        completed      = excluded.completed,
        active         = excluded.active,
        updated_at     = excluded.updated_at`,
    [
      chainId,
      contractAddress,
      campaignId,
      campaign.title || null,
      campaign.creator ? String(campaign.creator).toLowerCase() : null,
      String(campaign.targetAmount ?? "0"),
      String(campaign.raisedAmount ?? "0"),
      Number(campaign.deadline ?? 0),
      campaign.completed ? 1 : 0,
      campaign.active ? 1 : 0,
      Math.floor(Date.now() / 1000),
    ]
  );

  return getCampaign(chainId, contractAddress, campaignId);
}

export function getCampaign(chainId, contractAddress, campaignId) {
  const row = getRow(
    `SELECT * FROM campaign_cache WHERE chain_id = ? AND contract_address = ? AND campaign_id = ?`,
    [Number(chainId), String(contractAddress).toLowerCase(), Number(campaignId)]
  );
  return row ? mapCampaign(row) : null;
}

export function listCampaigns({ limit = 100 } = {}) {
  return query(
    `SELECT * FROM campaign_cache ORDER BY campaign_id DESC LIMIT ?`,
    [Math.min(Math.max(Number(limit) || 100, 1), 500)]
  ).map(mapCampaign);
}

function mapCampaign(row) {
  return {
    campaignId: Number(row.campaign_id),
    chainId: Number(row.chain_id),
    contractAddress: row.contract_address,
    title: row.title || null,
    creator: row.creator || null,
    targetAmountWei: String(row.target_amount || "0"),
    raisedAmountWei: String(row.raised_amount || "0"),
    deadline: Number(row.deadline || 0),
    completed: Number(row.completed) === 1,
    active: Number(row.active) === 1,
    updatedAt: Number(row.updated_at || 0),
  };
}
