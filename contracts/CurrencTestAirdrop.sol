// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @notice Sepolia-only test token. No deposits, approvals or server signing keys.
contract CurrencTestAirdrop is ERC20 {
    bytes32 public immutable merkleRoot;
    uint256 public immutable claimDeadline;
    uint256 public immutable allocationCap;
    address public immutable controller;
    bool public paused;
    mapping(uint256 => bool) public claimed;

    event RewardClaimed(uint256 indexed index, address indexed recipient, uint256 amount);
    event ClaimsPaused(bool paused);

    constructor(string memory name_, string memory symbol_, bytes32 root_, uint256 deadline_, uint256 cap_)
        ERC20(name_, symbol_)
    {
        require(block.chainid == 11155111, "Sepolia only");
        require(root_ != bytes32(0) && deadline_ > block.timestamp && cap_ > 0, "Invalid campaign");
        merkleRoot = root_;
        claimDeadline = deadline_;
        allocationCap = cap_;
        controller = msg.sender;
    }

    function decimals() public pure override returns (uint8) { return 6; }

    function setPaused(bool value) external {
        require(msg.sender == controller, "Controller only");
        paused = value;
        emit ClaimsPaused(value);
    }

    function claim(uint256 index, uint256 amount, bytes32[] calldata proof) external {
        require(!paused && block.timestamp < claimDeadline, "Claims unavailable");
        require(!claimed[index] && amount > 0, "Already claimed or empty");
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(index, msg.sender, amount))));
        require(MerkleProof.verifyCalldata(proof, merkleRoot, leaf), "Invalid allocation");
        require(totalSupply() + amount <= allocationCap, "Allocation cap");
        claimed[index] = true;
        _mint(msg.sender, amount);
        emit RewardClaimed(index, msg.sender, amount);
    }
}
