// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IArbWasm} from '../interfaces/IExternalContracts.sol';

/// @notice Test double for the ArbWasm precompile. Exposes knobs to simulate
///         expiry, configurable dataFee, refund-or-keep, and revert paths.
contract MockArbWasm is IArbWasm {
    uint64 public defaultTimeLeft;
    uint16 public version;
    uint256 public dataFee;
    bool public refundExcess;
    bool public shouldRevert;
    bool public timeLeftReverts;

    mapping(address => uint64) public timeLeftOverrides;
    mapping(address => bool) public hasTimeLeftOverride;

    event Activated(address program, uint256 valueReceived, uint256 dataFee);

    function setDefaultTimeLeft(uint64 _t) external {
        defaultTimeLeft = _t;
    }

    function setTimeLeftFor(address program, uint64 t) external {
        timeLeftOverrides[program] = t;
        hasTimeLeftOverride[program] = true;
    }

    function setVersion(uint16 _v) external {
        version = _v;
    }

    function setDataFee(uint256 _f) external {
        dataFee = _f;
    }

    function setRefundExcess(bool _r) external {
        refundExcess = _r;
    }

    function setShouldRevert(bool _r) external {
        shouldRevert = _r;
    }

    function setTimeLeftReverts(bool _r) external {
        timeLeftReverts = _r;
    }

    function programTimeLeft(
        address program
    ) external view override returns (uint64) {
        if (timeLeftReverts) revert('timeLeft revert');
        if (hasTimeLeftOverride[program]) return timeLeftOverrides[program];
        return defaultTimeLeft;
    }

    function activateProgram(
        address program
    ) external payable override returns (uint16, uint256) {
        if (shouldRevert) revert('activate revert');
        require(msg.value >= dataFee, 'insufficient value');
        emit Activated(program, msg.value, dataFee);
        if (refundExcess && msg.value > dataFee) {
            uint256 refund = msg.value - dataFee;
            (bool ok, ) = msg.sender.call{value: refund}('');
            require(ok, 'refund failed');
        }
        return (version, dataFee);
    }

    receive() external payable {}
}
