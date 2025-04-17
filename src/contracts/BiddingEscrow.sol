// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Escrow} from '@openzeppelin/contracts/utils/escrow/Escrow.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {Address} from '@openzeppelin/contracts/utils/Address.sol';

/**
 * @title Escrow
 * @dev Base escrow contract, holds funds designated for a payee until they
 * withdraw them.
 *
 * Intended usage: This contract (and derived escrow contracts) should be a
 * standalone contract, that only interacts with the contract that instantiated
 * it. That way, it is guaranteed that all Ether will be handled according to
 * the `Escrow` rules, and there is no need to check for payable functions or
 * transfers in the inheritance tree. The contract that uses the escrow as its
 * payment method should be its owner, and provide public methods redirecting
 * to the escrow's deposit and withdraw.
 */
contract BiddingEscrow is Ownable {
    using Address for address payable;

    event Deposited(address indexed payee, uint256 weiAmount);
    event Withdrawn(address indexed payee, uint256 weiAmount);

    mapping(address => uint256) private _deposits;

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
     * @dev Withdraws a specific amount from a user's balance to the owner contract for bid placement.
     * The withdrawn funds are sent to the owner (CacheManagerAutomation contract) to be used for bidding.
     *
     * WARNING: This function should only be called by the owner contract during bid placement.
     * Make sure proper checks are in place before calling this function.
     *
     * @param depositor The address whose funds will be partially withdrawn for bidding
     * @param amount The amount to withdraw for the bid
     *
     * Emits a {Withdrawn} event.
     */
    function withdrawForBid(
        address depositor,
        uint256 amount
    ) public onlyOwner {
        uint256 balance = _deposits[depositor];

        if (amount > balance) {
            revert('Amount exceeds balance');
        }

        _deposits[depositor] = balance - amount;

        payable(owner()).sendValue(amount);

        emit Withdrawn(depositor, amount);
    }
}
