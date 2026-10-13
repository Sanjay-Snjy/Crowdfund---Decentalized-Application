// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title CrowdfundingMarketplace
 * @dev Decentralized crowdfunding with milestone escrow and donor-approved releases.
 *
 * Trust model
 * -----------
 * 1. Donors contribute ETH. All donor funds stay in this contract until a milestone
 *    is approved by the donors; nothing is released up front.
 * 2. Every campaign has exactly MILESTONE_COUNT (3) milestones with fixed shares of
 *    the escrowed donor funds: 30% / 30% / 40%. The last milestone also receives any
 *    rounding remainder, so the three releases always account for exactly 100% of the
 *    escrowed donor funds.
 * 3. After the funding deadline, and only when the target was reached, the creator
 *    completes work and submits an IPFS CID as evidence for the next milestone.
 *    Donors then vote with voting power proportional to their current contribution.
 * 4. A milestone releases its share only when its own vote is approved AND every
 *    earlier milestone has already been released. Milestones can never be skipped.
 * 5. When the final milestone is released the campaign is completed. If a campaign
 *    fails to reach its target, donors refund their contributions.
 * 6. Recovery: if a funded campaign is abandoned (no milestone activity for
 *    MILESTONE_INACTIVITY_PERIOD plus RECOVERY_GRACE_PERIOD), donors can claim
 *    their pro-rata share of the remaining escrow. Recovery is one-way — once a
 *    donor claims, milestone releases and refunds for that campaign are closed.
 *
 * Creating a campaign is free: no deposit and no creation fee are charged.
 *
 * What the chain does and does not guarantee
 * ------------------------------------------
 * The contract records that evidence was submitted, who submitted it, when, how
 * donors voted and how much was released. It cannot verify that a photograph,
 * invoice or video is genuine or that funds were really spent as described.
 */
contract CrowdfundingMarketplace is ReentrancyGuard, Ownable, Pausable {

    // ─────────────────────────────────────────────────────────────────────────
    // Fund release model constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Fixed milestone shares of the escrowed donor funds. 30 + 30 + 40 = 100.
    uint256 public constant MILESTONE_1_PERCENT = 30;
    uint256 public constant MILESTONE_2_PERCENT = 30;
    uint256 public constant MILESTONE_3_PERCENT = 40;

    /// @dev Every campaign has exactly this many milestones.
    uint256 public constant MILESTONE_COUNT = 3;

    /// @dev Minimum share of the campaign's total voting power that has to participate
    ///      in a milestone vote before the milestone can be approved.
    uint256 public constant VOTE_QUORUM_PERCENT = 50;

    /// @dev Campaign creation fee. Kept at zero: launching a campaign is free.
    uint256 public constant CAMPAIGN_CREATION_FEE = 0 ether;

    /// @dev Milestone inactivity period. A campaign that reached its target but has
    ///      had no milestone activity (evidence submission or fund release) for this
    ///      long starts the recovery countdown.
    uint256 public constant MILESTONE_INACTIVITY_PERIOD = 90 days;

    /// @dev Extra grace period added on top of the inactivity period before donors
    ///      may claim their share of the escrow back. Long delays are legitimate, so
    ///      recovery is deliberately slow to become available.
    uint256 public constant RECOVERY_GRACE_PERIOD = 30 days;

    // Events

    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed creator,
        uint256 targetAmount,
        uint256 deadline,
        string metadataHash
    );

    event ContributionMade(
        uint256 indexed campaignId,
        address indexed contributor,
        uint256 amount
    );

    event CampaignFunded(
        uint256 indexed campaignId,
        uint256 totalRaised
    );

    event RefundIssued(
        uint256 indexed campaignId,
        address indexed contributor,
        uint256 amount
    );

    event FeesWithdrawn(
        address indexed admin,
        uint256 amount
    );

    event CommissionUpdated(
        uint256 oldCommission,
        uint256 newCommission
    );

    event MilestoneAdded(
        uint256 indexed campaignId,
        uint256 indexed milestoneIndex,
        string title,
        uint256 amount
    );

    event MilestoneEvidenceSubmitted(
        uint256 indexed campaignId,
        uint256 indexed milestoneIndex,
        string evidenceCID,
        uint256 votingPower
    );

    event MilestoneCompleted(
        uint256 indexed campaignId,
        uint256 indexed milestoneIndex
    );

    event MilestoneVoteRequested(
        uint256 indexed campaignId,
        uint256 indexed milestoneIndex
    );

    event MilestoneVoted(
        uint256 indexed campaignId,
        uint256 indexed milestoneIndex,
        address indexed contributor,
        bool approved
    );

    event MilestoneApproved(
        uint256 indexed campaignId,
        uint256 indexed milestoneIndex,
        uint256 approvalWeight,
        uint256 rejectionWeight
    );

    event MilestoneFundsReleased(
        uint256 indexed campaignId,
        uint256 indexed milestoneIndex,
        uint256 amount
    );

    event CampaignCompleted(
        uint256 indexed campaignId,
        address indexed creator,
        uint256 totalReleased
    );

    /// @dev Emitted the first time a donor claims recovery for an abandoned campaign.
    ///      From this point on the campaign's milestones can no longer be released.
    event CampaignRecoveryEnabled(
        uint256 indexed campaignId,
        uint256 escrowPool,
        uint256 claimBase
    );

    event RecoveryClaimed(
        uint256 indexed campaignId,
        address indexed contributor,
        uint256 amount
    );

    // Structs

    struct Campaign {
        uint256 id;
        address payable creator;
        string title;
        string description;
        string metadataHash; // IPFS hash for images and additional data
        uint256 targetAmount;
        uint256 raisedAmount; // donor funds held in escrow for this campaign
        uint256 deadline;
        bool completed; // true once every milestone has been released
        bool active;
        uint256 createdAt;
        uint256 contributorsCount;
        uint256 completedAt;
        // ── recovery accounting ──
        uint256 totalContributed; // sum of every contribution (refunds subtract again)
        uint256 lastActivityAt; // last evidence submission or fund release
        bool recoveryMode; // donors started recovering an abandoned campaign
        uint256 recoveryPool; // escrow snapshot taken when recovery mode was enabled
        uint256 recoveryBase; // totalContributed snapshot taken at the same moment
        uint256 recoveryClaimed; // total already paid out through recovery claims
    }

    struct Contribution {
        address contributor;
        uint256 amount;
        uint256 timestamp;
    }

    struct Milestone {
        string title;
        string description;
        uint256 amount; // release amount, derived from escrowed donor funds
        bool completed; // creator submitted evidence
        bool voteRequested; // donor voting is open (same trigger as evidence submission)
        bool fundsReleased;
        uint256 approvals; // number of donors that approved
        uint256 rejections; // number of donors that rejected
        uint256 createdAt;
        // ── milestone escrow accounting ──
        uint256 percentage; // fixed share of the escrowed donor funds (30/30/40)
        string evidenceCID; // IPFS CID of the evidence uploaded by the creator
        uint256 evidenceSubmittedAt;
        bool evidenceSubmitted;
        bool approved; // donor vote passed
        uint256 totalVotingPower; // donor funds snapshot taken when voting opened
        uint256 approvalWeight; // approving voting power, in wei
        uint256 rejectionWeight; // rejecting voting power, in wei
    }

    // State variables
    uint256 public totalFeesCollected; // platform treasury (creation fees; currently zero)
    uint256 public campaignCounter;

    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(address => uint256)) public contributions;
    mapping(uint256 => Contribution[]) public campaignContributions;
    mapping(uint256 => Milestone[]) public campaignMilestones;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public milestoneVoted;
    mapping(uint256 => mapping(address => bool)) public recoveryClaimedBy;
    mapping(uint256 => uint256) public releasedAmount;
    mapping(address => uint256[]) public userCampaigns;
    mapping(address => uint256[]) public userContributions;

    // Modifiers
    modifier validCampaign(uint256 _campaignId) {
        require(_campaignId > 0 && _campaignId <= campaignCounter, "Invalid campaign ID");
        require(campaigns[_campaignId].active, "Campaign is not active");
        _;
    }

    modifier onlyCampaignCreator(uint256 _campaignId) {
        require(campaigns[_campaignId].creator == msg.sender, "Not campaign creator");
        _;
    }

    modifier campaignNotEnded(uint256 _campaignId) {
        require(block.timestamp < campaigns[_campaignId].deadline, "Campaign has ended");
        _;
    }

    modifier campaignEnded(uint256 _campaignId) {
        require(block.timestamp >= campaigns[_campaignId].deadline, "Campaign still active");
        _;
    }

    modifier validMilestone(uint256 _campaignId, uint256 _milestoneIndex) {
        require(_campaignId > 0 && _campaignId <= campaignCounter, "Invalid campaign ID");
        require(_milestoneIndex < MILESTONE_COUNT, "Invalid milestone index");
        _;
    }

    constructor() {}

    // ─────────────────────────────────────────────────────────────────────────
    // Campaign lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Create a new crowdfunding campaign.
     *
     * Creating a campaign is free — no deposit and no creation fee are charged — and it
     * cannot be sent any ETH. The three fixed milestones (30% / 30% / 40%) are created
     * with the campaign.
     */
    function createCampaign(
        string memory _title,
        string memory _description,
        string memory _metadataHash,
        uint256 _targetAmount,
        uint256 _duration
    ) external whenNotPaused nonReentrant {
        require(_targetAmount > 0, "Target amount must be greater than 0");
        require(_duration > 0, "Duration must be greater than 0");
        require(bytes(_title).length > 0, "Title cannot be empty");
        require(bytes(_metadataHash).length > 0, "Metadata hash cannot be empty");

        campaignCounter++;
        uint256 campaignId = campaignCounter;
        uint256 deadline = block.timestamp + _duration;

        campaigns[campaignId] = Campaign({
            id: campaignId,
            creator: payable(msg.sender),
            title: _title,
            description: _description,
            metadataHash: _metadataHash,
            targetAmount: _targetAmount,
            raisedAmount: 0,
            deadline: deadline,
            completed: false,
            active: true,
            createdAt: block.timestamp,
            contributorsCount: 0,
            completedAt: 0,
            totalContributed: 0,
            // The countdown starts at the funding deadline: a campaign cannot be
            // abandoned before donors have had their full fundraising window.
            lastActivityAt: deadline,
            recoveryMode: false,
            recoveryPool: 0,
            recoveryBase: 0,
            recoveryClaimed: 0
        });

        userCampaigns[msg.sender].push(campaignId);
        totalFeesCollected += CAMPAIGN_CREATION_FEE;

        _initializeMilestones(campaignId);

        emit CampaignCreated(
            campaignId,
            msg.sender,
            _targetAmount,
            deadline,
            _metadataHash
        );
    }

    /**
     * @dev Contribute to a campaign. Donor funds stay in escrow until released
     *      milestone by milestone.
     */
    function contributeToCampaign(uint256 _campaignId)
        external
        payable
        validCampaign(_campaignId)
        campaignNotEnded(_campaignId)
        whenNotPaused
        nonReentrant
    {
        require(msg.value > 0, "Contribution must be greater than 0");
        require(campaigns[_campaignId].creator != msg.sender, "Cannot contribute to own campaign");

        Campaign storage campaign = campaigns[_campaignId];

        // First time contributor
        if (contributions[_campaignId][msg.sender] == 0) {
            campaign.contributorsCount++;
            userContributions[msg.sender].push(_campaignId);
        }

        contributions[_campaignId][msg.sender] += msg.value;
        campaign.raisedAmount += msg.value;
        campaign.totalContributed += msg.value;

        campaignContributions[_campaignId].push(Contribution({
            contributor: msg.sender,
            amount: msg.value,
            timestamp: block.timestamp
        }));

        emit ContributionMade(_campaignId, msg.sender, msg.value);

        // Check if target reached
        if (campaign.raisedAmount >= campaign.targetAmount) {
            emit CampaignFunded(_campaignId, campaign.raisedAmount);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Milestone evidence, voting and escrow release
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Creator submits the evidence for the next milestone and opens donor voting.
     *
     * Evidence itself lives on IPFS — only its CID is stored on-chain. Milestones are
     * handled strictly in order: evidence for milestone N can only be submitted after
     * milestone N-1 has been released.
     */
    function submitMilestoneEvidence(
        uint256 _campaignId,
        uint256 _milestoneIndex,
        string calldata _evidenceCID
    )
        external
        validCampaign(_campaignId)
        validMilestone(_campaignId, _milestoneIndex)
        onlyCampaignCreator(_campaignId)
        whenNotPaused
    {
        require(block.timestamp >= campaigns[_campaignId].deadline, "Campaign still fundraising");
        require(hasReachedTarget(_campaignId), "Campaign target not reached");
        require(!campaigns[_campaignId].recoveryMode, "Campaign is in donor recovery");
        require(
            _milestoneIndex == 0 ||
                campaignMilestones[_campaignId][_milestoneIndex - 1].fundsReleased,
            "Previous milestone not released"
        );
        require(bytes(_evidenceCID).length > 0, "Evidence CID cannot be empty");

        Milestone storage milestone = campaignMilestones[_campaignId][_milestoneIndex];
        require(!milestone.evidenceSubmitted, "Evidence already submitted");

        milestone.evidenceCID = _evidenceCID;
        milestone.evidenceSubmitted = true;
        milestone.evidenceSubmittedAt = block.timestamp;
        milestone.completed = true;
        milestone.voteRequested = true;
        // Voting power is capped by the donor funds that are actually escrowed.
        milestone.totalVotingPower = campaigns[_campaignId].raisedAmount;
        // Submitting evidence resets the abandonment countdown: the creator is
        // actively working on the campaign again.
        campaigns[_campaignId].lastActivityAt = block.timestamp;

        emit MilestoneCompleted(_campaignId, _milestoneIndex);
        emit MilestoneVoteRequested(_campaignId, _milestoneIndex);
        emit MilestoneEvidenceSubmitted(
            _campaignId,
            _milestoneIndex,
            _evidenceCID,
            milestone.totalVotingPower
        );
    }

    /**
     * @dev Donor votes on a milestone that has evidence attached.
     *
     * Voting power equals the donor's current contribution to the campaign, so a
     * donor that contributed more has proportionally more influence. Each donor can
     * vote once per milestone.
     */
    function voteOnMilestone(
        uint256 _campaignId,
        uint256 _milestoneIndex,
        bool _approve
    )
        external
        validCampaign(_campaignId)
        validMilestone(_campaignId, _milestoneIndex)
        whenNotPaused
        nonReentrant
    {
        require(campaigns[_campaignId].creator != msg.sender, "Campaign creator cannot vote");

        uint256 weight = contributions[_campaignId][msg.sender];
        require(weight > 0, "Only contributors can vote");

        Milestone storage milestone = campaignMilestones[_campaignId][_milestoneIndex];
        require(!campaigns[_campaignId].recoveryMode, "Campaign is in donor recovery");
        require(milestone.evidenceSubmitted, "Milestone evidence not submitted");
        require(!milestone.fundsReleased, "Funds already released for this milestone");
        require(!milestoneVoted[_campaignId][_milestoneIndex][msg.sender], "Contributor already voted");

        milestoneVoted[_campaignId][_milestoneIndex][msg.sender] = true;

        if (_approve) {
            milestone.approvals++;
            milestone.approvalWeight += weight;
        } else {
            milestone.rejections++;
            milestone.rejectionWeight += weight;
        }

        emit MilestoneVoted(_campaignId, _milestoneIndex, msg.sender, _approve);
    }

    /**
     * @dev Release the escrowed share of the next milestone.
     *
     * Callable by anyone once the donors approved the milestone with a majority of the
     * voting power that participated and enough voting power participated (quorum).
     * Only the milestone's own share is transferred — never more than one milestone at
     * a time.
     */
    function releaseMilestoneFunds(uint256 _campaignId, uint256 _milestoneIndex)
        external
        validMilestone(_campaignId, _milestoneIndex)
        whenNotPaused
        nonReentrant
    {
        require(block.timestamp >= campaigns[_campaignId].deadline, "Campaign still fundraising");
        require(hasReachedTarget(_campaignId), "Campaign target not reached");
        // Once donors have started recovering an abandoned campaign, no further
        // milestone share may be released to the creator.
        require(!campaigns[_campaignId].recoveryMode, "Campaign is in donor recovery");
        require(
            _milestoneIndex == 0 ||
                campaignMilestones[_campaignId][_milestoneIndex - 1].fundsReleased,
            "Previous milestone not released"
        );

        Milestone storage milestone = campaignMilestones[_campaignId][_milestoneIndex];
        require(milestone.evidenceSubmitted, "Milestone evidence not submitted");
        require(!milestone.fundsReleased, "Funds already released");
        require(milestoneApproved(_campaignId, _milestoneIndex), "Milestone not approved by donors");

        uint256 amount = milestoneReleaseAmount(_campaignId, _milestoneIndex);
        require(amount > 0, "Nothing to release");

        milestone.amount = amount;
        milestone.fundsReleased = true;
        milestone.approved = true;
        campaigns[_campaignId].lastActivityAt = block.timestamp;

        releasedAmount[_campaignId] += amount;
        campaigns[_campaignId].creator.transfer(amount);

        emit MilestoneApproved(
            _campaignId,
            _milestoneIndex,
            milestone.approvalWeight,
            milestone.rejectionWeight
        );
        emit MilestoneFundsReleased(_campaignId, _milestoneIndex, amount);

        if (_milestoneIndex == MILESTONE_COUNT - 1) {
            _completeCampaign(_campaignId);
        }
    }

    /**
     * @dev Get the refund for a failed campaign.
     *      Updates raisedAmount to keep accounting accurate and prevent contract
     *      insolvency if many contributors refund.
     */
    function getRefund(uint256 _campaignId)
        external
        validCampaign(_campaignId)
        campaignEnded(_campaignId)
        nonReentrant
    {
        Campaign storage campaign = campaigns[_campaignId];
        // Once donors have started recovering an abandoned campaign the escrow is
        // distributed by claimRecoveryShare, so refunds are closed to avoid paying
        // the same funds twice.
        require(!campaign.recoveryMode, "Campaign is in donor recovery");
        require(campaign.raisedAmount < campaign.targetAmount, "Campaign was successful");
        require(contributions[_campaignId][msg.sender] > 0, "No contribution found");

        uint256 refundAmount = contributions[_campaignId][msg.sender];
        contributions[_campaignId][msg.sender] = 0;

        // Decrease raisedAmount to keep accounting accurate.
        // Without this, raisedAmount could exceed the actual contract balance
        // after multiple refunds, breaking future withdrawal and refund logic.
        campaign.raisedAmount -= refundAmount;
        // Keep the donor-share base in sync as well (used by recovery claims).
        campaign.totalContributed -= refundAmount;

        payable(msg.sender).transfer(refundAmount);

        emit RefundIssued(_campaignId, msg.sender, refundAmount);
    }

    /**
     * @dev Emergency refund for contributors (admin only)
     */
    function emergencyRefund(uint256 _campaignId, address _contributor)
        external
        onlyOwner
        nonReentrant
    {
        require(contributions[_campaignId][_contributor] > 0, "No contribution found");

        uint256 refundAmount = contributions[_campaignId][_contributor];
        contributions[_campaignId][_contributor] = 0;
        campaigns[_campaignId].raisedAmount -= refundAmount;
        campaigns[_campaignId].totalContributed -= refundAmount;

        payable(_contributor).transfer(refundAmount);

        emit RefundIssued(_campaignId, _contributor, refundAmount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fund release accounting (views used by the release logic and by the UI)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Release amount of a milestone, expressed in wei of escrowed donor funds.
     *
     * Milestone 3 absorbs the rounding remainder so that the three releases add up to
     * exactly 100% of the escrowed donor funds and no dust is permanently locked.
     */
    function milestoneReleaseAmount(uint256 _campaignId, uint256 _milestoneIndex)
        public
        view
        validMilestone(_campaignId, _milestoneIndex)
        returns (uint256)
    {
        uint256 pool = campaigns[_campaignId].raisedAmount;
        uint256 firstShare = (pool * MILESTONE_1_PERCENT) / 100;
        uint256 secondShare = (pool * MILESTONE_2_PERCENT) / 100;

        if (_milestoneIndex == 0) return firstShare;
        if (_milestoneIndex == 1) return secondShare;
        // (pool - firstShare) - secondShare cannot underflow: both shares are <= 30%.
        return (pool - firstShare) - secondShare;
    }

    /**
     * @dev True when the milestone was approved by enough donor voting power.
     */
    function milestoneApproved(uint256 _campaignId, uint256 _milestoneIndex)
        public
        view
        returns (bool)
    {
        if (_campaignId == 0 || _campaignId > campaignCounter) return false;
        if (_milestoneIndex >= MILESTONE_COUNT) return false;

        Milestone storage milestone = campaignMilestones[_campaignId][_milestoneIndex];
        uint256 castWeight = milestone.approvalWeight + milestone.rejectionWeight;
        if (castWeight == 0) return false;

        // Strict majority of the voting power that participated.
        if (milestone.approvalWeight * 100 <= castWeight * 50) return false;

        // Quorum: enough of the campaign's voting power had to participate.
        return castWeight * 100 >= milestone.totalVotingPower * VOTE_QUORUM_PERCENT;
    }

    /**
     * @dev True once the campaign raised at least its target.
     */
    function hasReachedTarget(uint256 _campaignId) public view returns (bool) {
        return campaigns[_campaignId].raisedAmount >= campaigns[_campaignId].targetAmount;
    }

    /**
     * @dev Separate accounting view: donor funds, released funds and the donor funds
     *      that are still locked in escrow.
     */
    function getCampaignAccounting(uint256 _campaignId)
        external
        view
        returns (
            uint256 donorFundsRaised,
            uint256 releasedAmountTotal,
            uint256 lockedDonorFunds,
            uint256 refundableDonorFunds
        )
    {
        require(_campaignId > 0 && _campaignId <= campaignCounter, "Invalid campaign ID");
        Campaign storage campaign = campaigns[_campaignId];

        donorFundsRaised = campaign.raisedAmount;
        releasedAmountTotal = releasedAmount[_campaignId];
        // Donor funds still escrowed: everything collected minus what has been paid
        // out to the creator and minus approved recovery claims.
        lockedDonorFunds = campaign.raisedAmount - releasedAmountTotal - campaign.recoveryClaimed;
        refundableDonorFunds = !hasReachedTarget(_campaignId) &&
            block.timestamp >= campaign.deadline
            ? campaign.raisedAmount
            : 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Abandoned-campaign recovery
    //
    // A funded campaign whose milestones are never approved used to leave the
    // remaining escrow locked forever. Recovery gives donors a slow, explicit exit:
    // after MILESTONE_INACTIVITY_PERIOD + RECOVERY_GRACE_PERIOD without any
    // milestone activity, each donor can claim their pro-rata share of whatever is
    // still in escrow. A campaign that merely ran late is not affected — any
    // evidence submission or release restarts the countdown.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Donor funds still held in escrow for a campaign: what was collected minus
     *      everything already paid out to the creator (released milestones) and to
     *      the donors themselves (recovery claims).
     *
     *      `raisedAmount` is deliberately left untouched by recovery claims: it is the
     *      campaign's historical funding total (and what hasReachedTarget relies on),
     *      while this view answers "how much is still locked right now".
     */
    function recoveryEscrowPool(uint256 _campaignId) public view returns (uint256) {
        if (_campaignId == 0 || _campaignId > campaignCounter) return 0;
        Campaign storage campaign = campaigns[_campaignId];
        uint256 paidOut = releasedAmount[_campaignId] + campaign.recoveryClaimed;
        if (campaign.raisedAmount <= paidOut) return 0;
        return campaign.raisedAmount - paidOut;
    }

    /**
     * @dev Timestamp at which donor recovery becomes available. Counted from the
     *      later of the funding deadline and the last milestone activity (evidence
     *      submission or fund release), so a consistently active campaign can never
     *      be recovered while a milestone release is still realistic.
     */
    function recoveryUnlocksAt(uint256 _campaignId) public view returns (uint256) {
        if (_campaignId == 0 || _campaignId > campaignCounter) return 0;
        Campaign storage campaign = campaigns[_campaignId];
        uint256 inactivityStart = campaign.lastActivityAt > campaign.deadline
            ? campaign.lastActivityAt
            : campaign.deadline;
        return inactivityStart + MILESTONE_INACTIVITY_PERIOD + RECOVERY_GRACE_PERIOD;
    }

    /**
     * @dev True when donors may claim their share of the escrow back.
     *
     * Only a campaign that DID reach its target is recoverable — a campaign that
     * missed its target already has getRefund for every donor.
     */
    function recoveryEligible(uint256 _campaignId) public view returns (bool) {
        if (_campaignId == 0 || _campaignId > campaignCounter) return false;

        Campaign storage campaign = campaigns[_campaignId];
        if (campaign.completed) return false;
        if (!hasReachedTarget(_campaignId)) return false;
        if (recoveryEscrowPool(_campaignId) == 0) return false;
        if (block.timestamp < recoveryUnlocksAt(_campaignId)) return false;
        return true;
    }

    /**
     * @dev What a specific donor can still recover. Zero when recovery is not
     *      available, when the address never contributed, or after the single claim.
     */
    function recoveryClaimable(uint256 _campaignId, address _donor) external view returns (uint256) {
        if (!recoveryEligible(_campaignId)) return 0;
        if (recoveryClaimedBy[_campaignId][_donor]) return 0;

        Campaign storage campaign = campaigns[_campaignId];
        uint256 contribution = contributions[_campaignId][_donor];
        if (contribution == 0) return 0;

        uint256 pool = campaign.recoveryMode ? campaign.recoveryPool : recoveryEscrowPool(_campaignId);
        uint256 base = campaign.recoveryMode ? campaign.recoveryBase : campaign.totalContributed;
        if (base == 0) return 0;

        return (contribution * pool) / base;
    }

    /**
     * @dev Aggregated recovery state used by the UI (single read).
     */
    function getRecoveryState(uint256 _campaignId)
        external
        view
        returns (
            bool eligible,
            bool enabled,
            uint256 pool,
            uint256 base,
            uint256 claimed,
            uint256 escrow,
            uint256 unlocksAt
        )
    {
        Campaign storage campaign = campaigns[_campaignId];
        eligible = recoveryEligible(_campaignId);
        enabled = campaign.recoveryMode;
        pool = campaign.recoveryMode ? campaign.recoveryPool : recoveryEscrowPool(_campaignId);
        base = campaign.recoveryMode ? campaign.recoveryBase : campaign.totalContributed;
        claimed = campaign.recoveryClaimed;
        escrow = recoveryEscrowPool(_campaignId);
        unlocksAt = recoveryUnlocksAt(_campaignId);
    }

    /**
     * @dev Claim the caller's share of the escrow of an abandoned campaign.
     *
     * Pro-rata by contribution against a pool and a base that are frozen the first
     * time any donor claims, so every donor's share is deterministic, the sum of all
     * claims can never exceed the frozen pool, and no donor can ever claim twice.
     * The pool is the escrow that is genuinely left, so funds already released to
     * the creator are accounted for automatically.
     */
    function claimRecoveryShare(uint256 _campaignId) external nonReentrant {
        require(recoveryEligible(_campaignId), "Recovery not available");
        require(!recoveryClaimedBy[_campaignId][msg.sender], "Recovery already claimed");

        Campaign storage campaign = campaigns[_campaignId];
        uint256 contribution = contributions[_campaignId][msg.sender];
        require(contribution > 0, "No contribution to recover");

        if (!campaign.recoveryMode) {
            campaign.recoveryMode = true;
            campaign.recoveryPool = recoveryEscrowPool(_campaignId);
            campaign.recoveryBase = campaign.totalContributed;
            emit CampaignRecoveryEnabled(_campaignId, campaign.recoveryPool, campaign.recoveryBase);
        }

        require(campaign.recoveryBase > 0, "Recovery base is zero");

        uint256 share = (contribution * campaign.recoveryPool) / campaign.recoveryBase;
        require(share > 0, "Recovery share is zero");
        require(campaign.recoveryClaimed + share <= campaign.recoveryPool, "Recovery pool exhausted");

        // ── checks-effects-interactions: all state first, transfer last ──
        recoveryClaimedBy[_campaignId][msg.sender] = true;
        campaign.recoveryClaimed += share;
        // Zeroing the contribution is what makes a claim a once-only action and keeps
        // withdraw/refund paths from paying the same wei again.
        contributions[_campaignId][msg.sender] = 0;
        // Shrink the donor-share base so the remaining donors still split the frozen
        // pool proportionally to their original contributions.
        campaign.totalContributed -= contribution;

        payable(msg.sender).transfer(share);

        emit RecoveryClaimed(_campaignId, msg.sender, share);
    }

    // Admin

    /**
     * @dev Deactivate a campaign (admin only)
     */
    function deactivateCampaign(uint256 _campaignId) external onlyOwner {
        require(_campaignId > 0 && _campaignId <= campaignCounter, "Invalid campaign ID");
        campaigns[_campaignId].active = false;
    }

    /**
     * @dev Reactivate a campaign (admin only)
     */
    function reactivateCampaign(uint256 _campaignId) external onlyOwner {
        require(_campaignId > 0 && _campaignId <= campaignCounter, "Invalid campaign ID");
        require(block.timestamp < campaigns[_campaignId].deadline, "Campaign expired");
        campaigns[_campaignId].active = true;
    }

    /**
     * @dev Withdraw platform treasury funds (admin only).
     *      The treasury holds collected platform fees (currently zero).
     */
    function withdrawFees(uint256 _amount) external onlyOwner nonReentrant {
        require(_amount <= totalFeesCollected, "Insufficient fee balance");
        require(_amount <= address(this).balance, "Insufficient contract balance");

        totalFeesCollected -= _amount;
        payable(owner()).transfer(_amount);

        emit FeesWithdrawn(msg.sender, _amount);
    }

    /**
     * @dev Emergency withdrawal (admin only)
     */
    function emergencyWithdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        payable(owner()).transfer(balance);
    }

    /**
     * @dev Pause the contract (admin only)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause the contract (admin only)
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // View functions

    /**
     * @dev Get campaign details
     */
    function getCampaign(uint256 _campaignId) external view returns (Campaign memory) {
        require(_campaignId > 0 && _campaignId <= campaignCounter, "Invalid campaign ID");
        return campaigns[_campaignId];
    }

    /**
     * @dev Get user's contribution to a campaign
     */
    function getContribution(uint256 _campaignId, address _contributor)
        external
        view
        returns (uint256)
    {
        return contributions[_campaignId][_contributor];
    }

    /**
     * @dev Get all contributions for a campaign
     */
    function getCampaignContributions(uint256 _campaignId)
        external
        view
        returns (Contribution[] memory)
    {
        return campaignContributions[_campaignId];
    }

    /**
     * @dev Get user's created campaigns
     */
    function getUserCampaigns(address _user) external view returns (uint256[] memory) {
        return userCampaigns[_user];
    }

    /**
     * @dev Get user's contributed campaigns
     */
    function getUserContributions(address _user) external view returns (uint256[] memory) {
        return userContributions[_user];
    }

    /**
     * @dev Get active campaigns (paginated)
     */
    function getActiveCampaigns(uint256 _offset, uint256 _limit)
        external
        view
        returns (Campaign[] memory)
    {
        require(_limit > 0 && _limit <= 100, "Invalid limit");

        uint256 activeCount = 0;
        for (uint256 i = 1; i <= campaignCounter; i++) {
            if (campaigns[i].active) activeCount++;
        }

        if (_offset >= activeCount) {
            return new Campaign[](0);
        }

        uint256 returnCount = _limit;
        if (_offset + _limit > activeCount) {
            returnCount = activeCount - _offset;
        }

        Campaign[] memory result = new Campaign[](returnCount);
        uint256 resultIndex = 0;
        uint256 currentIndex = 0;

        for (uint256 i = 1; i <= campaignCounter && resultIndex < returnCount; i++) {
            if (campaigns[i].active) {
                if (currentIndex >= _offset) {
                    result[resultIndex] = campaigns[i];
                    resultIndex++;
                }
                currentIndex++;
            }
        }

        return result;
    }

    /**
     * @dev Check if campaign is successful
     */
    function isCampaignSuccessful(uint256 _campaignId) external view returns (bool) {
        require(_campaignId > 0 && _campaignId <= campaignCounter, "Invalid campaign ID");
        return hasReachedTarget(_campaignId);
    }

    /**
     * @dev Get campaign statistics
     */
    function getCampaignStats(uint256 _campaignId)
        external
        view
        returns (
            uint256 raisedAmount,
            uint256 targetAmount,
            uint256 contributorsCount,
            uint256 timeLeft,
            bool isActive,
            bool isSuccessful
        )
    {
        require(_campaignId > 0 && _campaignId <= campaignCounter, "Invalid campaign ID");
        Campaign memory campaign = campaigns[_campaignId];

        raisedAmount = campaign.raisedAmount;
        targetAmount = campaign.targetAmount;
        contributorsCount = campaign.contributorsCount;
        timeLeft = block.timestamp >= campaign.deadline ? 0 : campaign.deadline - block.timestamp;
        isActive = campaign.active;
        isSuccessful = campaign.raisedAmount >= campaign.targetAmount;
    }

    /**
     * @dev Get contract statistics
     */
    function getContractStats()
        external
        view
        returns (
            uint256 totalCampaigns,
            uint256 totalFees,
            uint256 contractBalance
        )
    {
        totalCampaigns = campaignCounter;
        totalFees = totalFeesCollected;
        contractBalance = address(this).balance;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Milestone views
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Get milestone count for a campaign
     */
    function getMilestoneCount(uint256 _campaignId) external view returns (uint256) {
        return campaignMilestones[_campaignId].length;
    }

    /**
     * @dev Get milestone details for a campaign
     */
    function getMilestone(uint256 _campaignId, uint256 _milestoneIndex)
        external
        view
        returns (
            string memory title,
            string memory description,
            uint256 amount,
            bool completed,
            bool voteRequested,
            bool fundsReleased,
            uint256 approvals,
            uint256 rejections,
            uint256 createdAt,
            uint256 percentage,
            string memory evidenceCID,
            uint256 evidenceSubmittedAt
        )
    {
        Milestone storage milestone = campaignMilestones[_campaignId][_milestoneIndex];
        return (
            milestone.title,
            milestone.description,
            milestone.amount,
            milestone.completed,
            milestone.voteRequested,
            milestone.fundsReleased,
            milestone.approvals,
            milestone.rejections,
            milestone.createdAt,
            milestone.percentage,
            milestone.evidenceCID,
            milestone.evidenceSubmittedAt
        );
    }

    /**
     * @dev Get all milestones for a campaign in a single call (batch read)
     * @param _campaignId Campaign ID
     */
    function getMilestones(uint256 _campaignId)
        external
        view
        returns (Milestone[] memory)
    {
        return campaignMilestones[_campaignId];
    }

    /**
     * @dev Get contributor vote status for a milestone
     */
    function hasVotedOnMilestone(
        uint256 _campaignId,
        uint256 _milestoneIndex,
        address _contributor
    ) external view returns (bool) {
        return milestoneVoted[_campaignId][_milestoneIndex][_contributor];
    }

    /**
     * @dev Get the amount already released via milestones for a campaign
     */
    function getReleasedAmount(uint256 _campaignId) external view returns (uint256) {
        return releasedAmount[_campaignId];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Create the three fixed milestones for a campaign (30% / 30% / 40%).
     *      Release amounts stay at zero until the escrow is actually released.
     */
    function _initializeMilestones(uint256 _campaignId) internal {
        Milestone[] storage milestones = campaignMilestones[_campaignId];

        milestones.push(_newMilestone("Milestone 1", MILESTONE_1_PERCENT));
        milestones.push(_newMilestone("Milestone 2", MILESTONE_2_PERCENT));
        milestones.push(_newMilestone("Milestone 3", MILESTONE_3_PERCENT));

        emit MilestoneAdded(_campaignId, 0, "Milestone 1", MILESTONE_1_PERCENT);
        emit MilestoneAdded(_campaignId, 1, "Milestone 2", MILESTONE_2_PERCENT);
        emit MilestoneAdded(_campaignId, 2, "Milestone 3", MILESTONE_3_PERCENT);
    }

    function _newMilestone(string memory _title, uint256 _percentage)
        internal
        view
        returns (Milestone memory)
    {
        return
            Milestone({
                title: _title,
                description: "",
                amount: 0,
                completed: false,
                voteRequested: false,
                fundsReleased: false,
                approvals: 0,
                rejections: 0,
                createdAt: block.timestamp,
                percentage: _percentage,
                evidenceCID: "",
                evidenceSubmittedAt: 0,
                evidenceSubmitted: false,
                approved: false,
                totalVotingPower: 0,
                approvalWeight: 0,
                rejectionWeight: 0
            });
    }

    /**
     * @dev Mark the campaign as completed once every milestone has been released.
     */
    function _completeCampaign(uint256 _campaignId) internal {
        Campaign storage campaign = campaigns[_campaignId];

        campaign.completed = true;
        campaign.completedAt = block.timestamp;
        campaign.active = false;

        emit CampaignCompleted(
            _campaignId,
            campaign.creator,
            releasedAmount[_campaignId]
        );
    }

    /**
     * @dev Fallback function to receive Ether
     */
    receive() external payable {}
}
