import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/index.js';
import { balanceService, bidService } from '../services/index.js';

export async function createUser(req: Request, res: Response): Promise<void> {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
        res.status(400).json({ success: false, error: 'Username required' });
        return;
    }

    const existing = await User.findOne({ username });
    if (existing) {
        res.status(400).json({ success: false, error: 'Username already exists' });
        return;
    }

    const user = await User.create({ username, balance: 0, frozenBalance: 0 });

    res.json({
        success: true,
        data: {
            id: user._id,
            username: user.username,
            balance: user.balance,
            frozenBalance: user.frozenBalance,
        },
    });
}

export async function getMe(req: Request, res: Response): Promise<void> {
    const user = await User.findById(req.userId);

    if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
    }

    res.json({
        success: true,
        data: {
            id: user._id,
            username: user.username,
            balance: user.balance,
            frozenBalance: user.frozenBalance,
        },
    });
}

export async function deposit(req: Request, res: Response): Promise<void> {
    const { amount } = req.body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
        res.status(400).json({ success: false, error: 'Valid amount required' });
        return;
    }

    const user = await balanceService.deposit(req.userId!, amount);

    res.json({
        success: true,
        data: {
            id: user._id,
            username: user.username,
            balance: user.balance,
            frozenBalance: user.frozenBalance,
        },
    });
}

export async function getMyWins(req: Request, res: Response): Promise<void> {
    const wins = await bidService.getUserWins(req.userId!);

    res.json({
        success: true,
        data: wins.map((bid) => ({
            id: bid._id,
            auctionId: bid.auctionId,
            amount: bid.amount,
            itemNumber: bid.itemNumber,
            wonInRound: bid.wonInRound,
        })),
    });
}

export async function getMyBids(req: Request, res: Response): Promise<void> {
    const bids = await bidService.getUserBidHistory(req.userId!);

    res.json({
        success: true,
        data: bids.map((bid) => ({
            id: bid._id,
            auctionId: bid.auctionId,
            amount: bid.amount,
            status: bid.status,
            itemNumber: bid.itemNumber,
            createdAt: bid.createdAt,
        })),
    });
}

export async function loginOrRegister(req: Request, res: Response): Promise<void> {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
        res.status(400).json({ success: false, error: 'Username required' });
        return;
    }

    let user = await User.findOne({ username });

    if (!user) {
        user = await User.create({ username, balance: 10000, frozenBalance: 0 });
    }

    res.json({
        success: true,
        data: {
            id: user._id,
            username: user.username,
            balance: user.balance,
            frozenBalance: user.frozenBalance,
        },
    });
}
