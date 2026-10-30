// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Sportula} from "../Sportula.sol";

// ───────────────────────────── Mocks ─────────────────────────────

/// @dev Minimal 6-decimal ERC20 used as USDC.
contract MockUSDC {
    string public name = "Mock USDC";
    string public symbol = "mUSDC";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amt) external {
        totalSupply += amt;
        balanceOf[to] += amt;
        emit Transfer(address(0), to, amt);
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        emit Approval(msg.sender, spender, amt);
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        _move(msg.sender, to, amt);
        _afterTransfer(to);
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amt, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amt;
        _move(from, to, amt);
        return true;
    }

    function _move(address from, address to, uint256 amt) internal virtual {
        require(balanceOf[from] >= amt, "balance");
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        emit Transfer(from, to, amt);
    }

    function _afterTransfer(address to) internal virtual {}
}

/// @dev Delivers 1 unit less than requested (fee-on-transfer / short-delivering).
contract FeeToken is MockUSDC {
    function _move(address from, address to, uint256 amt) internal override {
        require(balanceOf[from] >= amt, "balance");
        balanceOf[from] -= amt;
        uint256 got = amt > 0 ? amt - 1 : 0;
        balanceOf[to] += got;
        totalSupply -= (amt - got);
        emit Transfer(from, to, got);
    }
}

interface ITokenHook {
    function onTokenReceived() external;
}

/// @dev transfer() calls back into the recipient if it is a contract.
contract ReentrantToken is MockUSDC {
    function _afterTransfer(address to) internal override {
        if (to.code.length > 0) ITokenHook(to).onTokenReceived();
    }
}

/// @dev Acts as provider (claim) or payer (withdraw) and tries to re-enter Sportula from the token callback.
contract Attacker is ITokenHook {
    Sportula public s;
    MockUSDC public token;
    uint256 public reTabId;
    uint256 public reCumulative;
    bytes public reSig;
    bool public reenterClaim;
    bool public reenterWithdraw;
    uint256 public hookCalls;
    bool public claimOk;
    bool public withdrawOk;
    bytes public claimErr;
    bytes public withdrawErr;

    constructor(Sportula s_, MockUSDC token_) {
        s = s_;
        token = token_;
    }

    function arm(bool claimRe, bool withdrawRe, uint256 tabId, uint256 cum, bytes calldata sig) external {
        reenterClaim = claimRe;
        reenterWithdraw = withdrawRe;
        reTabId = tabId;
        reCumulative = cum;
        reSig = sig;
    }

    function openTab(address provider, uint256 amt, uint64 exp) external returns (uint256) {
        token.approve(address(s), amt);
        return s.open(provider, amt, exp);
    }

    function doClaim(uint256 tabId, uint256 cum, bytes calldata sig) external {
        s.claim(tabId, cum, sig);
    }

    function doWithdraw(uint256 tabId) external {
        s.withdraw(tabId);
    }

    function onTokenReceived() external override {
        hookCalls++;
        if (hookCalls > 1) return;
        if (reenterClaim) {
            try s.claim(reTabId, reCumulative, reSig) {
                claimOk = true;
            } catch (bytes memory e) {
                claimErr = e;
            }
        }
        if (reenterWithdraw) {
            try s.withdraw(reTabId) {
                withdrawOk = true;
            } catch (bytes memory e) {
                withdrawErr = e;
            }
        }
    }
}

// ───────────────────────────── Base ─────────────────────────────

abstract contract SportulaBase is Test {
    MockUSDC internal usdc;
    Sportula internal s;

    address internal alice;
    uint256 internal alicePk;
    address internal mallory;
    uint256 internal malloryPk;
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant DEP = 1_000e6;
    uint256 internal constant START = 1_000_000;
    uint64 internal exp;

    event TabOpened(uint256 indexed tabId, address indexed payer, address indexed provider, uint256 amount, uint64 expiry);
    event Claimed(uint256 indexed tabId, address indexed provider, uint256 paid, uint256 cumulativeClaimed);
    event Withdrawn(uint256 indexed tabId, address indexed payer, uint256 amount);

    function setUp() public virtual {
        vm.warp(START);
        (alice, alicePk) = makeAddrAndKey("alice");
        (mallory, malloryPk) = makeAddrAndKey("mallory");
        exp = uint64(START + 1 days);
        usdc = new MockUSDC();
        s = new Sportula(IERC20(address(usdc)));
        usdc.mint(alice, 1e30);
        vm.prank(alice);
        usdc.approve(address(s), type(uint256).max);
    }

    function _open() internal returns (uint256 id) {
        vm.prank(alice);
        id = s.open(bob, DEP, exp);
    }

    function _sig(uint256 pk, uint256 id, uint256 amt) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(pk, s.voucherDigest(id, amt));
        return abi.encodePacked(r, ss, v);
    }

    function _claim(uint256 id, uint256 amt) internal {
        bytes memory sig = _sig(alicePk, id, amt);
        vm.prank(bob);
        s.claim(id, amt, sig);
    }

    function _claimed(uint256 id) internal view returns (uint256 c) {
        (,,, c,,) = s.tab(id);
    }

    /// @dev Σ (deposit - claimed) over all unwithdrawn tabs.
    function _outstanding(Sportula sp) internal view returns (uint256 sum) {
        uint256 n = sp.nextTabId();
        for (uint256 i = 1; i < n; i++) {
            (,, uint256 d, uint256 c,, bool w) = sp.tab(i);
            if (!w) sum += d - c;
        }
    }
}

// ───────────────────────────── Unit tests ─────────────────────────────

contract SportulaTest is SportulaBase {
    bytes4 internal immutable TAB_NOT_FOUND = Sportula.TabNotFound.selector;

    // ---- constructor / EIP-712 ----

    function test_Constructor_StoresUsdc() public view {
        assertEq(address(s.USDC()), address(usdc));
        assertEq(s.nextTabId(), 1);
    }

    function test_Constructor_RevertsOnZeroUsdc() public {
        vm.expectRevert(Sportula.ZeroUSDC.selector);
        new Sportula(IERC20(address(0)));
    }

    function test_Eip712_DigestAndDomainSeparatorMatchIndependentComputation() public view {
        bytes32 domainTypeHash =
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        bytes32 domainSep = keccak256(
            abi.encode(domainTypeHash, keccak256(bytes("Sportula")), keccak256(bytes("1")), block.chainid, address(s))
        );
        assertEq(s.DOMAIN_SEPARATOR(), domainSep);

        bytes32 typeHash = keccak256("Voucher(uint256 tabId,uint256 cumulativeAmount)");
        assertEq(s.VOUCHER_TYPEHASH(), typeHash);
        uint256 id = 7;
        uint256 amt = 123e6;
        bytes32 structHash = keccak256(abi.encode(typeHash, id, amt));
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        assertEq(s.voucherDigest(id, amt), expected);
    }

    // ---- happy path ----

    function test_HappyPath_OpenClaimClaimWithdraw() public {
        uint256 aliceStart = usdc.balanceOf(alice);

        vm.expectEmit(true, true, true, true, address(s));
        emit TabOpened(1, alice, bob, DEP, exp);
        uint256 id = _open();
        assertEq(id, 1);
        assertEq(usdc.balanceOf(address(s)), DEP);
        assertEq(usdc.balanceOf(alice), aliceStart - DEP);
        (address p, address pr, uint256 d, uint256 c, uint64 e, bool w) = s.tab(1);
        assertEq(p, alice);
        assertEq(pr, bob);
        assertEq(d, DEP);
        assertEq(c, 0);
        assertEq(e, exp);
        assertFalse(w);

        // first claim: cumulative 300
        bytes memory sig1 = _sig(alicePk, 1, 300e6);
        vm.expectEmit(true, true, false, true, address(s));
        emit Claimed(1, bob, 300e6, 300e6);
        vm.prank(bob);
        s.claim(1, 300e6, sig1);
        assertEq(usdc.balanceOf(bob), 300e6);
        assertEq(_claimed(1), 300e6);
        assertEq(usdc.balanceOf(address(s)), 700e6);

        // second claim: higher cumulative 700 -> pays only the delta 400
        bytes memory sig2 = _sig(alicePk, 1, 700e6);
        vm.expectEmit(true, true, false, true, address(s));
        emit Claimed(1, bob, 400e6, 700e6);
        vm.prank(bob);
        s.claim(1, 700e6, sig2);
        assertEq(usdc.balanceOf(bob), 700e6);
        assertEq(_claimed(1), 700e6);
        assertEq(usdc.balanceOf(address(s)), 300e6);

        // withdraw after expiry
        vm.warp(exp);
        vm.expectEmit(true, true, false, true, address(s));
        emit Withdrawn(1, alice, 300e6);
        vm.prank(alice);
        s.withdraw(1);
        assertEq(usdc.balanceOf(alice), aliceStart - 700e6);
        assertEq(usdc.balanceOf(bob), 700e6);
        assertEq(usdc.balanceOf(address(s)), 0);
        (,,,,, bool wd) = s.tab(1);
        assertTrue(wd);
    }

    function test_Claim_LastSecondBeforeExpirySucceeds() public {
        _open();
        vm.warp(exp - 1);
        _claim(1, DEP);
        assertEq(usdc.balanceOf(bob), DEP);
    }

    function test_Withdraw_ExactlyAtExpirySucceeds() public {
        _open();
        vm.warp(exp);
        vm.prank(alice);
        s.withdraw(1);
        assertEq(usdc.balanceOf(address(s)), 0);
    }

    // ---- claim reverts ----

    function test_Claim_ReplaySameVoucherReverts() public {
        _open();
        bytes memory sig = _sig(alicePk, 1, 400e6);
        vm.prank(bob);
        s.claim(1, 400e6, sig);
        vm.expectRevert(abi.encodeWithSelector(Sportula.NotIncreasing.selector, 1, 400e6, 400e6));
        vm.prank(bob);
        s.claim(1, 400e6, sig);
        assertEq(usdc.balanceOf(bob), 400e6);
    }

    function test_Claim_LowerCumulativeReverts() public {
        _open();
        _claim(1, 500e6);
        bytes memory sig = _sig(alicePk, 1, 200e6);
        vm.expectRevert(abi.encodeWithSelector(Sportula.NotIncreasing.selector, 1, 200e6, 500e6));
        vm.prank(bob);
        s.claim(1, 200e6, sig);
    }

    function test_Claim_ZeroCumulativeRevertsNotIncreasing() public {
        _open();
        bytes memory sig = _sig(alicePk, 1, 0);
        vm.expectRevert(abi.encodeWithSelector(Sportula.NotIncreasing.selector, 1, 0, 0));
        vm.prank(bob);
        s.claim(1, 0, sig);
    }

    function test_Claim_AboveDepositReverts() public {
        _open();
        bytes memory sig = _sig(alicePk, 1, DEP + 1);
        vm.expectRevert(abi.encodeWithSelector(Sportula.ExceedsDeposit.selector, 1, DEP + 1, DEP));
        vm.prank(bob);
        s.claim(1, DEP + 1, sig);
        assertEq(usdc.balanceOf(address(s)), DEP);
    }

    function test_Claim_ExactDepositSucceeds() public {
        _open();
        _claim(1, DEP);
        assertEq(usdc.balanceOf(bob), DEP);
        assertEq(usdc.balanceOf(address(s)), 0);
    }

    function test_Claim_SignedByNonPayerReverts() public {
        _open();
        bytes memory sig = _sig(malloryPk, 1, 100e6);
        vm.expectRevert(abi.encodeWithSelector(Sportula.InvalidSignature.selector, 1));
        vm.prank(bob);
        s.claim(1, 100e6, sig);
    }

    function test_Claim_VoucherForAmountMismatchReverts() public {
        _open();
        bytes memory sig = _sig(alicePk, 1, 100e6);
        vm.expectRevert(abi.encodeWithSelector(Sportula.InvalidSignature.selector, 1));
        vm.prank(bob);
        s.claim(1, 101e6, sig);
    }

    function test_Claim_VoucherForOtherTabReverts() public {
        _open(); // tab 1
        _open(); // tab 2
        bytes memory sigForA = _sig(alicePk, 1, 100e6);
        vm.expectRevert(abi.encodeWithSelector(Sportula.InvalidSignature.selector, 2));
        vm.prank(bob);
        s.claim(2, 100e6, sigForA);
    }

    function test_Claim_ByNonProviderReverts() public {
        _open();
        bytes memory sig = _sig(alicePk, 1, 100e6);
        vm.expectRevert(abi.encodeWithSelector(Sportula.NotProvider.selector, 1));
        vm.prank(carol);
        s.claim(1, 100e6, sig);
        vm.expectRevert(abi.encodeWithSelector(Sportula.NotProvider.selector, 1));
        vm.prank(alice);
        s.claim(1, 100e6, sig);
    }

    function test_Claim_ExactlyAtExpiryReverts() public {
        _open();
        bytes memory sig = _sig(alicePk, 1, 100e6);
        vm.warp(exp);
        vm.expectRevert(abi.encodeWithSelector(Sportula.TabExpired.selector, 1, exp));
        vm.prank(bob);
        s.claim(1, 100e6, sig);
    }

    function test_Claim_AfterExpiryReverts() public {
        _open();
        bytes memory sig = _sig(alicePk, 1, 100e6);
        vm.warp(exp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(Sportula.TabExpired.selector, 1, exp));
        vm.prank(bob);
        s.claim(1, 100e6, sig);
    }

    function test_Claim_AfterWithdrawReverts() public {
        _open();
        bytes memory sig = _sig(alicePk, 1, 100e6);
        vm.warp(exp);
        vm.prank(alice);
        s.withdraw(1);
        // Expiry is checked first; TabClosed is unreachable (see report).
        vm.expectRevert(abi.encodeWithSelector(Sportula.TabExpired.selector, 1, exp));
        vm.prank(bob);
        s.claim(1, 100e6, sig);
        assertEq(usdc.balanceOf(bob), 0);
    }

    // ---- signature malformation ----

    function test_Claim_MalformedSignaturesRevert() public {
        _open();
        bytes[3] memory bad = [bytes(""), new bytes(10), new bytes(66)];
        for (uint256 i = 0; i < bad.length; i++) {
            vm.expectRevert(abi.encodeWithSelector(Sportula.InvalidSignature.selector, 1));
            vm.prank(bob);
            s.claim(1, 100e6, bad[i]);
        }
    }

    function test_Claim_ZeroSignatureRevert() public {
        _open();
        vm.expectRevert(abi.encodeWithSelector(Sportula.InvalidSignature.selector, 1));
        vm.prank(bob);
        s.claim(1, 100e6, new bytes(65));
    }

    function test_Claim_HighSMalleatedSignatureReverts() public {
        _open();
        bytes32 digest = s.voucherDigest(1, 100e6);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(alicePk, digest);
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 sHigh = bytes32(n - uint256(ss));
        uint8 vFlip = v == 27 ? 28 : 27;
        // sanity: the raw precompile would accept the malleated sig for alice
        assertEq(ecrecover(digest, vFlip, r, sHigh), alice);
        vm.expectRevert(abi.encodeWithSelector(Sportula.InvalidSignature.selector, 1));
        vm.prank(bob);
        s.claim(1, 100e6, abi.encodePacked(r, sHigh, vFlip));
        // the canonical signature still works
        vm.prank(bob);
        s.claim(1, 100e6, abi.encodePacked(r, ss, v));
        assertEq(usdc.balanceOf(bob), 100e6);
    }

    // ---- withdraw ----

    function test_Withdraw_BeforeExpiryReverts() public {
        _open();
        vm.expectRevert(abi.encodeWithSelector(Sportula.NotYetExpired.selector, 1, exp));
        vm.prank(alice);
        s.withdraw(1);
        vm.warp(exp - 1);
        vm.expectRevert(abi.encodeWithSelector(Sportula.NotYetExpired.selector, 1, exp));
        vm.prank(alice);
        s.withdraw(1);
    }

    function test_Withdraw_ByNonPayerReverts() public {
        _open();
        vm.warp(exp);
        vm.expectRevert(abi.encodeWithSelector(Sportula.NotPayer.selector, 1));
        vm.prank(bob);
        s.withdraw(1);
        vm.expectRevert(abi.encodeWithSelector(Sportula.NotPayer.selector, 1));
        vm.prank(carol);
        s.withdraw(1);
    }

    function test_Withdraw_DoubleWithdrawReverts() public {
        _open();
        vm.warp(exp);
        vm.prank(alice);
        s.withdraw(1);
        vm.expectRevert(abi.encodeWithSelector(Sportula.AlreadyWithdrawn.selector, 1));
        vm.prank(alice);
        s.withdraw(1);
    }

    function test_Withdraw_AfterFullClaimReturnsZeroAndCloses() public {
        _open();
        _claim(1, DEP);
        vm.warp(exp);
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(s));
        emit Withdrawn(1, alice, 0);
        vm.prank(alice);
        s.withdraw(1);
        assertEq(usdc.balanceOf(alice), aliceBefore);
        (,,,,, bool wd) = s.tab(1);
        assertTrue(wd);
        vm.expectRevert(abi.encodeWithSelector(Sportula.AlreadyWithdrawn.selector, 1));
        vm.prank(alice);
        s.withdraw(1);
    }

    function test_Withdraw_FullRefundWhenNothingClaimed() public {
        uint256 start = usdc.balanceOf(alice);
        _open();
        vm.warp(exp + 5);
        vm.prank(alice);
        s.withdraw(1);
        assertEq(usdc.balanceOf(alice), start);
        assertEq(usdc.balanceOf(address(s)), 0);
    }

    // ---- open validations ----

    function test_Open_ZeroProviderReverts() public {
        vm.expectRevert(Sportula.ZeroProvider.selector);
        vm.prank(alice);
        s.open(address(0), DEP, exp);
    }

    function test_Open_ZeroAmountReverts() public {
        vm.expectRevert(Sportula.ZeroAmount.selector);
        vm.prank(alice);
        s.open(bob, 0, exp);
    }

    function test_Open_ProviderIsPayerReverts() public {
        vm.expectRevert(Sportula.ProviderIsPayer.selector);
        vm.prank(alice);
        s.open(alice, DEP, exp);
    }

    function test_Open_ExpiryInPastReverts() public {
        vm.expectRevert(Sportula.InvalidExpiry.selector);
        vm.prank(alice);
        s.open(bob, DEP, uint64(START - 1));
    }

    function test_Open_ExpiryEqualNowReverts() public {
        vm.expectRevert(Sportula.InvalidExpiry.selector);
        vm.prank(alice);
        s.open(bob, DEP, uint64(START));
    }

    function test_Open_ExpiryOneSecondAheadSucceeds() public {
        vm.prank(alice);
        uint256 id = s.open(bob, DEP, uint64(START + 1));
        assertEq(id, 1);
    }

    function test_Open_WithoutAllowanceReverts() public {
        usdc.mint(carol, DEP);
        vm.expectRevert();
        vm.prank(carol);
        s.open(bob, DEP, exp);
        assertEq(s.nextTabId(), 1);
    }

    // ---- ids / unknown tabs ----

    function test_TabIds_IncrementFromOne() public {
        assertEq(s.nextTabId(), 1);
        assertEq(_open(), 1);
        assertEq(_open(), 2);
        assertEq(_open(), 3);
        assertEq(s.nextTabId(), 4);
        (address p0,,,,,) = s.tab(0);
        assertEq(p0, address(0));
        (address p9,,,,,) = s.tab(4);
        assertEq(p9, address(0));
    }

    function test_UnknownTab_ClaimAndWithdrawRevert() public {
        _open();
        bytes memory sig = _sig(alicePk, 99, 1);
        vm.expectRevert(abi.encodeWithSelector(TAB_NOT_FOUND, 99));
        vm.prank(bob);
        s.claim(99, 1, sig);
        vm.expectRevert(abi.encodeWithSelector(TAB_NOT_FOUND, 0));
        vm.prank(bob);
        s.claim(0, 1, sig);
        vm.expectRevert(abi.encodeWithSelector(TAB_NOT_FOUND, 99));
        vm.prank(alice);
        s.withdraw(99);
        vm.expectRevert(abi.encodeWithSelector(TAB_NOT_FOUND, 0));
        vm.prank(alice);
        s.withdraw(0);
    }

    function test_MultipleTabs_AreIndependent() public {
        _open();
        vm.prank(alice);
        s.open(carol, 500e6, exp + 1 days);
        _claim(1, 250e6);
        assertEq(_claimed(2), 0);
        assertEq(usdc.balanceOf(address(s)), DEP - 250e6 + 500e6);
        vm.warp(exp); // tab 1 expired, tab 2 still live
        vm.expectRevert(abi.encodeWithSelector(Sportula.NotYetExpired.selector, 2, exp + 1 days));
        vm.prank(alice);
        s.withdraw(2);
        vm.prank(alice);
        s.withdraw(1);
        assertEq(usdc.balanceOf(address(s)), 500e6);
        assertEq(_outstanding(s), 500e6);
    }
}

// ───────────────────────── Hostile-token tests ─────────────────────────

contract SportulaTokenTest is SportulaBase {
    function test_Open_FeeOnTransferTokenReverts() public {
        FeeToken fee = new FeeToken();
        Sportula sp = new Sportula(IERC20(address(fee)));
        fee.mint(alice, DEP);
        vm.startPrank(alice);
        fee.approve(address(sp), DEP);
        vm.expectRevert(abi.encodeWithSelector(Sportula.UnexpectedReceivedAmount.selector, DEP, DEP - 1));
        sp.open(bob, DEP, exp);
        vm.stopPrank();
        assertEq(sp.nextTabId(), 1);
        assertEq(fee.balanceOf(alice), DEP);
        assertEq(fee.balanceOf(address(sp)), 0);
    }

    function _setupReentrant() internal returns (ReentrantToken tok, Sportula sp, Attacker atk) {
        tok = new ReentrantToken();
        sp = new Sportula(IERC20(address(tok)));
        atk = new Attacker(sp, tok);
    }

    function test_Reentrancy_ClaimCallbackIsBlocked() public {
        (ReentrantToken tok, Sportula sp, Attacker atk) = _setupReentrant();
        tok.mint(alice, DEP);
        vm.startPrank(alice);
        tok.approve(address(sp), DEP);
        sp.open(address(atk), DEP, exp);
        vm.stopPrank();

        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(alicePk, sp.voucherDigest(1, 400e6));
        bytes memory sig400 = abi.encodePacked(r, ss, v);
        (v, r, ss) = vm.sign(alicePk, sp.voucherDigest(1, DEP));
        bytes memory sigFull = abi.encodePacked(r, ss, v);

        atk.arm(true, true, 1, DEP, sigFull);
        atk.doClaim(1, 400e6, sig400);

        bytes memory guardErr = abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(atk.hookCalls(), 1, "callback ran");
        assertFalse(atk.claimOk());
        assertFalse(atk.withdrawOk());
        assertEq(atk.claimErr(), guardErr);
        assertEq(atk.withdrawErr(), guardErr);
        assertEq(tok.balanceOf(address(atk)), 400e6);
        assertEq(tok.balanceOf(address(sp)), DEP - 400e6);
        (,,, uint256 c,, bool w) = sp.tab(1);
        assertEq(c, 400e6);
        assertFalse(w);
    }

    function test_Reentrancy_WithdrawCallbackIsBlocked() public {
        (ReentrantToken tok, Sportula sp, Attacker atk) = _setupReentrant();
        tok.mint(address(atk), DEP);
        atk.openTab(bob, DEP, exp);
        atk.arm(true, true, 1, 100e6, new bytes(65));
        vm.warp(exp);
        atk.doWithdraw(1);

        bytes memory guardErr = abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(atk.hookCalls(), 1, "callback ran");
        assertFalse(atk.claimOk());
        assertFalse(atk.withdrawOk());
        assertEq(atk.claimErr(), guardErr);
        assertEq(atk.withdrawErr(), guardErr);
        assertEq(tok.balanceOf(address(atk)), DEP, "refunded exactly once");
        assertEq(tok.balanceOf(address(sp)), 0);
        (,,,,, bool w) = sp.tab(1);
        assertTrue(w);
    }
}

// ───────────────────────────── Fuzz tests ─────────────────────────────

contract SportulaFuzzTest is SportulaBase {
    function testFuzz_ClaimAllThenWithdraw_ConservesFunds(uint256 dep1, uint256 dep2, uint256 seed, uint8 n) public {
        dep1 = bound(dep1, 1, 1e24);
        dep2 = bound(dep2, 1, 1e24);
        uint256 steps = bound(n, 1, 8);
        uint256 aliceStart = usdc.balanceOf(alice);

        vm.startPrank(alice);
        uint256 id1 = s.open(bob, dep1, exp);
        uint256 id2 = s.open(carol, dep2, exp);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(s)), dep1 + dep2);

        // tab 2: single partial claim by carol (interleaved with tab 1 accounting)
        uint256 c2 = bound(seed, 1, dep2);
        {
            bytes memory sig2 = _sig(alicePk, id2, c2);
            vm.prank(carol);
            s.claim(id2, c2, sig2);
            assertEq(usdc.balanceOf(address(s)), _outstanding(s));
        }

        // tab 1: random increasing cumulative amounts
        uint256 cum;
        for (uint256 i = 0; i < steps && cum < dep1; i++) {
            uint256 inc = bound(uint256(keccak256(abi.encode(seed, i))), 1, dep1 - cum);
            cum += inc;
            bytes memory sig = _sig(alicePk, id1, cum);
            vm.prank(bob);
            s.claim(id1, cum, sig);
            assertEq(usdc.balanceOf(bob), cum);
            assertEq(_claimed(id1), cum);
            assertEq(usdc.balanceOf(address(s)), _outstanding(s));
        }

        // claim everything left on tab 1 (when the loop did not reach the deposit)
        if (cum < dep1 && seed % 2 == 0) {
            cum = dep1;
            bytes memory sigAll = _sig(alicePk, id1, cum);
            vm.prank(bob);
            s.claim(id1, cum, sigAll);
        }

        vm.warp(exp);
        vm.startPrank(alice);
        s.withdraw(id1);
        assertEq(usdc.balanceOf(address(s)), _outstanding(s));
        s.withdraw(id2);
        vm.stopPrank();

        // PROPERTY: payout + refund == deposit for each tab; nothing stranded.
        assertEq(usdc.balanceOf(bob) + (dep1 - _claimed(id1)), dep1);
        assertEq(usdc.balanceOf(carol) + (dep2 - _claimed(id2)), dep2);
        assertEq(usdc.balanceOf(bob), cum);
        assertEq(usdc.balanceOf(carol), c2);
        assertEq(usdc.balanceOf(alice), aliceStart - cum - c2);
        assertEq(usdc.balanceOf(address(s)), 0);
        assertEq(_outstanding(s), 0);
    }

    function testFuzz_ClaimAboveDeposit_RevertsAndLeavesBalances(uint256 dep, uint256 cum, uint256 pre) public {
        dep = bound(dep, 1, 1e24);
        cum = bound(cum, dep + 1, type(uint256).max);
        pre = bound(pre, 0, dep);

        vm.prank(alice);
        uint256 id = s.open(bob, dep, exp);
        if (pre > 0) _claim(id, pre);

        uint256 sBal = usdc.balanceOf(address(s));
        uint256 bobBal = usdc.balanceOf(bob);
        uint256 aliceBal = usdc.balanceOf(alice);

        bytes memory sig = _sig(alicePk, id, cum); // validly signed, still must fail
        vm.expectRevert(abi.encodeWithSelector(Sportula.ExceedsDeposit.selector, id, cum, dep));
        vm.prank(bob);
        s.claim(id, cum, sig);

        assertEq(usdc.balanceOf(address(s)), sBal);
        assertEq(usdc.balanceOf(bob), bobBal);
        assertEq(usdc.balanceOf(alice), aliceBal);
        assertEq(_claimed(id), pre);
    }

    function testFuzz_NonIncreasingClaimReverts(uint256 dep, uint256 first, uint256 again) public {
        dep = bound(dep, 1, 1e24);
        first = bound(first, 1, dep);
        again = bound(again, 0, first);
        vm.prank(alice);
        uint256 id = s.open(bob, dep, exp);
        _claim(id, first);
        bytes memory sig = _sig(alicePk, id, again);
        vm.expectRevert(abi.encodeWithSelector(Sportula.NotIncreasing.selector, id, again, first));
        vm.prank(bob);
        s.claim(id, again, sig);
        assertEq(usdc.balanceOf(bob), first);
    }

    function testFuzz_SignatureFromAnyoneElseReverts(uint256 pk, uint256 dep, uint256 cum) public {
        pk = bound(pk, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        vm.assume(vm.addr(pk) != alice);
        dep = bound(dep, 1, 1e24);
        cum = bound(cum, 1, dep);
        vm.prank(alice);
        uint256 id = s.open(bob, dep, exp);
        bytes memory sig = _sig(pk, id, cum);
        vm.expectRevert(abi.encodeWithSelector(Sportula.InvalidSignature.selector, id));
        vm.prank(bob);
        s.claim(id, cum, sig);
    }
}

// ───────────────────────────── Invariant test ─────────────────────────────

contract SportulaHandler {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    Sportula public s;
    MockUSDC public usdc;
    uint256 public payerPk;
    address public payer;
    address[2] public providers;
    uint256 public ghostDeposited;
    uint256 public ghostClaimed;
    uint256 public ghostWithdrawn;

    constructor(Sportula s_, MockUSDC usdc_, uint256 pk, address p1, address p2) {
        s = s_;
        usdc = usdc_;
        payerPk = pk;
        payer = vm.addr(pk);
        providers = [p1, p2];
        usdc.mint(payer, 1e30);
        vm.prank(payer);
        usdc.approve(address(s), type(uint256).max);
    }

    function _b(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return lo + (x % (hi - lo + 1));
    }

    function open(uint256 amt, uint256 who, uint256 ttl) external {
        amt = _b(amt, 1, 1e12);
        ttl = _b(ttl, 1, 30 days);
        vm.prank(payer);
        s.open(providers[who % 2], amt, uint64(block.timestamp + ttl));
        ghostDeposited += amt;
    }

    function claim(uint256 tabSeed, uint256 incSeed) external {
        uint256 n = s.nextTabId();
        if (n == 1) return;
        uint256 id = _b(tabSeed, 1, n - 1);
        (, address prov, uint256 d, uint256 c, uint64 e, bool w) = s.tab(id);
        if (block.timestamp >= e || w || c >= d) return;
        uint256 cum = _b(incSeed, c + 1, d);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(payerPk, s.voucherDigest(id, cum));
        vm.prank(prov);
        s.claim(id, cum, abi.encodePacked(r, ss, v));
        ghostClaimed += cum - c;
    }

    function withdraw(uint256 tabSeed) external {
        uint256 n = s.nextTabId();
        if (n == 1) return;
        uint256 id = _b(tabSeed, 1, n - 1);
        (, , uint256 d, uint256 c, uint64 e, bool w) = s.tab(id);
        if (block.timestamp < e || w) return;
        vm.prank(payer);
        s.withdraw(id);
        ghostWithdrawn += d - c;
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + _b(dt, 1, 10 days));
    }
}

contract SportulaInvariantTest is Test {
    MockUSDC internal usdc;
    Sportula internal s;
    SportulaHandler internal h;

    function setUp() public {
        vm.warp(1_000_000);
        usdc = new MockUSDC();
        s = new Sportula(IERC20(address(usdc)));
        h = new SportulaHandler(s, usdc, 0xA11CE, makeAddr("p1"), makeAddr("p2"));
        targetContract(address(h));
    }

    /// custody == Σ(deposit - claimed) over unwithdrawn tabs
    function invariant_BalanceEqualsOutstanding() public view {
        uint256 sum;
        uint256 n = s.nextTabId();
        for (uint256 i = 1; i < n; i++) {
            (,, uint256 d, uint256 c,, bool w) = s.tab(i);
            if (!w) sum += d - c;
        }
        assertEq(usdc.balanceOf(address(s)), sum);
    }

    /// every deposited unit is either in custody, paid to a provider, or refunded
    function invariant_Conservation() public view {
        assertEq(h.ghostDeposited(), usdc.balanceOf(address(s)) + h.ghostClaimed() + h.ghostWithdrawn());
    }
}
