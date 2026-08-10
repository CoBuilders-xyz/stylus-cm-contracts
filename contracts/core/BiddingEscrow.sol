// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {Address} from '@openzeppelin/contracts/utils/Address.sol';

/**
 * @title Bidding Escrow
 * @notice Holds user funds used by CacheManagerAutomation for cache bids and
 * program activations.
 * @dev The deploying CacheManagerAutomation contract owns this contract and
 * exclusively manages deposits, user withdrawals, and transfers needed for
 * protocol operations.
 */
contract BiddingEscrow is Ownable {
    using Address for address payable;

    event Deposited(address indexed payee, uint256 weiAmount);
    event Withdrawn(address indexed payee, uint256 weiAmount);
    event WithdrawnForAutomation(
        address indexed depositor,
        address indexed recipient,
        uint256 weiAmount
    );

    mapping(address account => uint256 balance) private _deposits;

    function depositsOf(address payee) public view returns (uint256) {
        return _deposits[payee];
    }

    /**
     * @dev Stores the sent amount as credit to be withdrawn.
     * @param payee The destination address of the funds.
     *
     * Emits a {Deposited} event.
     */
    function deposit(address payee) public payable virtual onlyOwner {
        uint256 amount = msg.value;
        _deposits[payee] += amount;
        emit Deposited(payee, amount);
    }

    /**
     * @dev Withdraw accumulated balance for a payee, forwarding all gas to the
     * recipient.
     *
     * WARNING: Forwarding all gas opens the door to reentrancy vulnerabilities.
     * Make sure you trust the recipient, or are either following the
     * checks-effects-interactions pattern or using {ReentrancyGuard}.
     *
     * @param payee The address whose funds will be withdrawn and transferred to.
     *
     * Emits a {Withdrawn} event.
     */
    function withdraw(address payable payee) public virtual onlyOwner {
        uint256 payment = _deposits[payee];

        _deposits[payee] = 0;

        payee.sendValue(payment);

        emit Withdrawn(payee, payment);
    }

    /**
     * @dev Withdraws a specific amount from a user's balance to the owner
     * contract for cache bids or program activations.
     *
     * WARNING: This function should only be called by the owner contract while
     * executing one of those operations.
     *
     * @param depositor The address whose funds will be partially withdrawn
     * @param amount The amount to withdraw for the protocol operation
     *
     * Emits a {WithdrawnForAutomation} event.
     */
    function withdrawForAutomation(
        address depositor,
        uint256 amount
    ) public onlyOwner {
        uint256 balance = _deposits[depositor];

        if (amount > balance) {
            revert('Amount exceeds balance');
        }

        _deposits[depositor] = balance - amount;

        address recipient = owner();
        payable(recipient).sendValue(amount);

        emit WithdrawnForAutomation(depositor, recipient, amount);
    }
}
