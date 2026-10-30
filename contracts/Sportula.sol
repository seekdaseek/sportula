// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Sportula
/// @notice Prepaid USDC tabs settled with payer-signed cumulative EIP-712 vouchers.
/// @dev Payers must be EOA signers; ERC-1271 contract-wallet signatures are unsupported.
/// Vouchers are cumulative: only the highest valid voucher matters, not their sum.
/// Payers cannot reclaim before expiry. Providers must claim strictly before expiry
/// or lose unclaimed funds to the payer's withdrawal at or after expiry.
/// Accounted USDC custody equals the sum of (deposit - claimed) for unwithdrawn tabs,
/// including expired tabs awaiting withdrawal. Unsolicited token transfers may add
/// surplus, which cannot be recovered. Assumes standard, non-rebasing USDC behavior.
/// No privileged roles, fees, upgrades, or native-currency payment handling exist.
/// Known risk (accepted, by design of a keyless contract): all tabs share one custody address.
/// If the USDC issuer blocklists this contract, claims and withdrawals fail for every tab, and
/// no on-contract rescue can bypass that; recovery would depend on the issuer.
contract Sportula is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Tab {
        address payer;
        address provider;
        uint256 deposit;
        uint256 claimed;
        uint64 expiry;
        bool withdrawn;
    }

    error ZeroUSDC();
    error ZeroProvider();
    error ZeroAmount();
    error ProviderIsPayer();
    error InvalidExpiry();
    error UnexpectedReceivedAmount(uint256 expected, uint256 received);
    error TabNotFound(uint256 tabId);
    error NotProvider(uint256 tabId);
    error TabExpired(uint256 tabId, uint64 expiry);
    error TabClosed(uint256 tabId);
    error NotIncreasing(uint256 tabId, uint256 cumulativeAmount, uint256 claimed);
    error ExceedsDeposit(uint256 tabId, uint256 cumulativeAmount, uint256 deposit);
    error InvalidSignature(uint256 tabId);
    error NotPayer(uint256 tabId);
    error NotYetExpired(uint256 tabId, uint64 expiry);
    error AlreadyWithdrawn(uint256 tabId);

    event TabOpened(
        uint256 indexed tabId,
        address indexed payer,
        address indexed provider,
        uint256 amount,
        uint64 expiry
    );
    event Claimed(
        uint256 indexed tabId,
        address indexed provider,
        uint256 paid,
        uint256 cumulativeClaimed
    );
    event Withdrawn(uint256 indexed tabId, address indexed payer, uint256 amount);

    /// @notice On Arc, use USDC at 0x3600000000000000000000000000000000000000 (6 decimals).
    IERC20 public immutable USDC;
    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(uint256 tabId,uint256 cumulativeAmount)");

    /// @notice IDs start at 1; tab ID 0 never exists. IDs are never reused.
    uint256 public nextTabId = 1;
    mapping(uint256 => Tab) private _tabs;

    constructor(IERC20 usdc_) EIP712("Sportula", "1") {
        if (address(usdc_) == address(0)) revert ZeroUSDC();
        USDC = usdc_;
    }

    /// @notice Prepay a provider; amount is in USDC base units and expiry is a Unix timestamp.
    /// @dev Requires a prior USDC allowance. Non-exact incoming transfers revert atomically.
    function open(address provider, uint256 amount, uint64 expiry)
        external
        nonReentrant
        returns (uint256 tabId)
    {
        if (provider == address(0)) revert ZeroProvider();
        if (amount == 0) revert ZeroAmount();
        if (provider == msg.sender) revert ProviderIsPayer();
        if (expiry <= block.timestamp) revert InvalidExpiry();

        tabId = nextTabId;
        _tabs[tabId] = Tab({
            payer: msg.sender,
            provider: provider,
            deposit: amount,
            claimed: 0,
            expiry: expiry,
            withdrawn: false
        });
        nextTabId = tabId + 1;

        uint256 balanceBefore = USDC.balanceOf(address(this));
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = USDC.balanceOf(address(this));
        uint256 received = balanceAfter >= balanceBefore ? balanceAfter - balanceBefore : 0;
        if (received != amount) revert UnexpectedReceivedAmount(amount, received);
        // The stored deposit equals the measured receipt; any discrepancy reverts the entire open.

        emit TabOpened(tabId, msg.sender, provider, received, expiry);
    }

    /// @notice Claim the increase authorized by an EOA payer's cumulative voucher before expiry.
    function claim(uint256 tabId, uint256 cumulativeAmount, bytes calldata signature)
        external
        nonReentrant
    {
        Tab storage t = _tabs[tabId];
        if (t.payer == address(0)) revert TabNotFound(tabId);
        if (msg.sender != t.provider) revert NotProvider(tabId);
        if (block.timestamp >= t.expiry) revert TabExpired(tabId, t.expiry);
        if (t.withdrawn) revert TabClosed(tabId);
        if (cumulativeAmount <= t.claimed) revert NotIncreasing(tabId, cumulativeAmount, t.claimed);
        if (cumulativeAmount > t.deposit) revert ExceedsDeposit(tabId, cumulativeAmount, t.deposit);

        (address signer, ECDSA.RecoverError err,) =
            ECDSA.tryRecover(_voucherDigest(tabId, cumulativeAmount), signature);
        if (err != ECDSA.RecoverError.NoError || signer != t.payer) revert InvalidSignature(tabId);

        uint256 paid = cumulativeAmount - t.claimed;
        t.claimed = cumulativeAmount;
        USDC.safeTransfer(t.provider, paid);

        emit Claimed(tabId, t.provider, paid, cumulativeAmount);
    }

    /// @notice Close an expired tab and recover its unclaimed funds, including a zero remainder.
    function withdraw(uint256 tabId) external nonReentrant {
        Tab storage t = _tabs[tabId];
        if (t.payer == address(0)) revert TabNotFound(tabId);
        if (msg.sender != t.payer) revert NotPayer(tabId);
        if (block.timestamp < t.expiry) revert NotYetExpired(tabId, t.expiry);
        if (t.withdrawn) revert AlreadyWithdrawn(tabId);

        t.withdrawn = true;
        uint256 amount = t.deposit - t.claimed;
        if (amount != 0) USDC.safeTransfer(t.payer, amount);

        emit Withdrawn(tabId, t.payer, amount);
    }

    /// @notice Return tab details; unknown IDs (including 0) return all-zero values.
    function tab(uint256 tabId)
        external
        view
        returns (
            address payer,
            address provider,
            uint256 deposit,
            uint256 claimed,
            uint64 expiry,
            bool withdrawn
        )
    {
        Tab storage t = _tabs[tabId];
        return (t.payer, t.provider, t.deposit, t.claimed, t.expiry, t.withdrawn);
    }

    /// @notice Return the EIP-712 digest for a voucher; does not validate tab existence or amounts.
    function voucherDigest(uint256 tabId, uint256 cumulativeAmount) external view returns (bytes32) {
        return _voucherDigest(tabId, cumulativeAmount);
    }

    /// @notice Return the domain separator binding signatures to this chain and contract.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _voucherDigest(uint256 tabId, uint256 cumulativeAmount) private view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, tabId, cumulativeAmount)));
    }
}
