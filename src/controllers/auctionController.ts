import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { auctionService, bidService, roundService } from '../services/index.js';
import { Bid, User } from '../models/index.js';

export async function getAllAuctions(_req: Request, res: Response): Promise<void> {
    const auctions = await auctionService.getAll();

    res.json({
        success: true,
        data: auctions.map((a) => ({
            id: a._id,
            name: a.name,
            description: a.description,
            totalItems: a.totalItems,
            totalRounds: a.totalRounds,
            currentRound: a.currentRound,
            status: a.status,
            startAt: a.startAt,
            distributedItems: a.distributedItems,
            avgPrice: a.avgPrice,
        })),
    });
}

export async function getAuction(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: 'Invalid auction ID' });
        return;
    }

    const auction = await auctionService.getById(new mongoose.Types.ObjectId(id));

    if (!auction) {
        res.status(404).json({ success: false, error: 'Auction not found' });
        return;
    }

    const activeRound = await roundService.getActiveRound(auction._id);

    let minBid = 1;
    let totalBids = 0;

    if (activeRound) {
        minBid = await roundService.getMinBidForWin(activeRound._id);
        totalBids = await roundService.getTotalBidsCount(activeRound._id);
    }

    res.json({
        success: true,
        data: {
            id: auction._id,
            name: auction.name,
            description: auction.description,
            totalItems: auction.totalItems,
            totalRounds: auction.totalRounds,
            itemsPerRound: auction.itemsPerRound,
            currentRound: auction.currentRound,
            status: auction.status,
            startAt: auction.startAt,
            distributedItems: auction.distributedItems,
            avgPrice: auction.avgPrice,
            minBid: auction.minBid,  // Minimum bid for auction
            activeRound: activeRound
                ? {
                    id: activeRound._id,
                    roundNumber: activeRound.roundNumber,
                    startAt: activeRound.startAt,
                    endAt: activeRound.endAt,
                    winnersCount: activeRound.winnersCount,
                    minBidForWin: minBid,  // Minimum bid to enter top winners
                    totalBids,
                }
                : null,
        },
    });
}

export async function getLeaderboard(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: 'Invalid auction ID' });
        return;
    }

    const auctionId = new mongoose.Types.ObjectId(id);
    const activeRound = await roundService.getActiveRound(auctionId);

    if (!activeRound) {
        res.json({ success: true, data: [] });
        return;
    }

    const leaderboard = await roundService.getRoundLeaderboard(activeRound._id, limit);

    const userIds = leaderboard.map((l) => l.userId);
    const users = await User.find({ _id: { $in: userIds } });
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    res.json({
        success: true,
        data: leaderboard.map((l) => ({
            rank: l.rank,
            userId: l.userId,
            username: userMap.get(l.userId.toString())?.username || 'Unknown',
            amount: l.amount,
        })),
    });
}

export async function createAuction(req: Request, res: Response): Promise<void> {
    const { name, description, totalItems, totalRounds, winnersPerRound, minBid, startAt, firstRoundDuration, otherRoundDuration } = req.body;

    if (!name || !totalItems || !totalRounds || !startAt) {
        res.status(400).json({ success: false, error: 'Missing required fields' });
        return;
    }

    const auction = await auctionService.create({
        name,
        description,
        totalItems,
        totalRounds,
        winnersPerRound,
        minBid,
        startAt: new Date(startAt),
        firstRoundDuration,
        otherRoundDuration,
    });

    res.json({
        success: true,
        data: {
            id: auction._id,
            name: auction.name,
            totalItems: auction.totalItems,
            totalRounds: auction.totalRounds,
            itemsPerRound: auction.itemsPerRound,
            minBid: auction.minBid,
            startAt: auction.startAt,
        },
    });
}

export async function placeBid(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { amount } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: 'Invalid auction ID' });
        return;
    }

    if (!amount || typeof amount !== 'number' || amount <= 0) {
        res.status(400).json({ success: false, error: 'Valid amount required' });
        return;
    }

    try {
        const result = await bidService.placeBid(
            req.userId!,
            new mongoose.Types.ObjectId(id),
            amount
        );

        const rank = await bidService.getUserBidRank(req.userId!, new mongoose.Types.ObjectId(id));

        res.json({
            success: true,
            data: {
                id: result.bid._id,
                amount: result.bid.amount,
                rank,
                antiSnipingTriggered: result.antiSnipingTriggered,
            },
        });
    } catch (err) {
        res.status(400).json({ success: false, error: (err as Error).message });
    }
}

export async function getMyBid(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: 'Invalid auction ID' });
        return;
    }

    const auctionId = new mongoose.Types.ObjectId(id);
    const bid = await bidService.getUserBid(req.userId!, auctionId);

    if (!bid) {
        res.json({ success: true, data: null });
        return;
    }

    const rank = await bidService.getUserBidRank(req.userId!, auctionId);

    res.json({
        success: true,
        data: {
            id: bid._id,
            amount: bid.amount,
            rank,
            status: bid.status,
        },
    });
}

export async function getBidsCount(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: 'Invalid auction ID' });
        return;
    }

    const auctionId = new mongoose.Types.ObjectId(id);
    const activeRound = await roundService.getActiveRound(auctionId);

    if (!activeRound) {
        res.json({ success: true, data: { count: 0 } });
        return;
    }

    const count = await Bid.countDocuments({
        roundId: activeRound._id,
        status: 'active',
    });

    res.json({ success: true, data: { count } });
}
