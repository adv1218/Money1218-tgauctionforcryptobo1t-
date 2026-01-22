import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { z } from 'zod';

import { User, Bid, Auction } from '../models/index.js';
import { auctionService, bidService, roundService, balanceService } from '../services/index.js';
import { scheduleAuctionStart } from '../jobs/queues.js';
import {
    LoginSchema,
    DepositSchema,
    CreateAuctionSchema,
    PlaceBidSchema,
    IdParamsSchema,
    LeaderboardQuerySchema,
    type LoginInput,
    type DepositInput,
    type CreateAuctionInput,
    type PlaceBidInput,
    type IdParams,
    type LeaderboardQuery,
} from '../schemas/index.js';

// Auth middleware
async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    const userId = request.headers['x-user-id'] as string;

    if (!userId) {
        return reply.status(401).send({ success: false, error: 'User ID required' });
    }

    const parseResult = z.string().regex(/^[0-9a-fA-F]{24}$/).safeParse(userId);
    if (!parseResult.success) {
        return reply.status(400).send({ success: false, error: 'Invalid user ID' });
    }

    const user = await User.findById(userId);
    if (!user) {
        return reply.status(404).send({ success: false, error: 'User not found' });
    }

    request.userId = new mongoose.Types.ObjectId(userId);
}

// Validation helper
function validateBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
    const result = schema.safeParse(body);
    if (!result.success) {
        const error = new Error(result.error.errors[0]?.message || 'Validation failed');
        (error as any).statusCode = 400;
        throw error;
    }
    return result.data;
}

function validateParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
    const result = schema.safeParse(params);
    if (!result.success) {
        const error = new Error(result.error.errors[0]?.message || 'Invalid parameters');
        (error as any).statusCode = 400;
        throw error;
    }
    return result.data;
}

function validateQuery<T>(schema: z.ZodSchema<T>, query: unknown): T {
    const result = schema.safeParse(query);
    if (!result.success) {
        const error = new Error(result.error.errors[0]?.message || 'Invalid query');
        (error as any).statusCode = 400;
        throw error;
    }
    return result.data;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
    // ============ USER ROUTES ============

    // Login or register
    app.post('/api/users/login', async (request, reply) => {
        const { username } = validateBody(LoginSchema, request.body);

        let user = await User.findOne({ username });
        if (!user) {
            user = await User.create({ username, balance: 10000, frozenBalance: 0 });
        }

        return {
            success: true,
            data: {
                id: user._id,
                username: user.username,
                balance: user.balance,
                frozenBalance: user.frozenBalance,
            },
        };
    });

    // Create user
    app.post('/api/users', async (request, reply) => {
        const { username } = validateBody(LoginSchema, request.body);

        const existing = await User.findOne({ username });
        if (existing) {
            return reply.status(400).send({ success: false, error: 'Username already exists' });
        }

        const user = await User.create({ username, balance: 0, frozenBalance: 0 });

        return {
            success: true,
            data: {
                id: user._id,
                username: user.username,
                balance: user.balance,
                frozenBalance: user.frozenBalance,
            },
        };
    });

    // Get current user
    app.get('/api/users/me', { preHandler: authMiddleware }, async (request) => {
        const user = await User.findById(request.userId);
        if (!user) {
            throw new Error('User not found');
        }

        return {
            success: true,
            data: {
                id: user._id,
                username: user.username,
                balance: user.balance,
                frozenBalance: user.frozenBalance,
            },
        };
    });

    // Deposit
    app.post('/api/users/me/deposit', { preHandler: authMiddleware }, async (request) => {
        const { amount } = validateBody(DepositSchema, request.body);
        const user = await balanceService.deposit(request.userId!, amount);

        return {
            success: true,
            data: {
                id: user._id,
                username: user.username,
                balance: user.balance,
                frozenBalance: user.frozenBalance,
            },
        };
    });

    // Get user wins
    app.get('/api/users/me/wins', { preHandler: authMiddleware }, async (request) => {
        const wins = await bidService.getUserWins(request.userId!);

        return {
            success: true,
            data: wins.map((bid) => ({
                id: bid._id,
                auctionId: bid.auctionId,
                amount: bid.amount,
                itemNumber: bid.itemNumber,
                wonInRound: bid.wonInRound,
            })),
        };
    });

    // Get user bids
    app.get('/api/users/me/bids', { preHandler: authMiddleware }, async (request) => {
        const bids = await bidService.getUserBidHistory(request.userId!);

        return {
            success: true,
            data: bids.map((bid) => ({
                id: bid._id,
                auctionId: bid.auctionId,
                amount: bid.amount,
                status: bid.status,
                itemNumber: bid.itemNumber,
                createdAt: bid.createdAt,
            })),
        };
    });

    // ============ AUCTION ROUTES ============

    // Get all auctions
    app.get('/api/auctions', async () => {
        const auctions = await auctionService.getAll();

        return {
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
        };
    });

    // Get auction by ID
    app.get('/api/auctions/:id', async (request) => {
        const { id } = validateParams(IdParamsSchema, request.params);
        const auction = await auctionService.getById(new mongoose.Types.ObjectId(id));

        if (!auction) {
            const error = new Error('Auction not found');
            (error as any).statusCode = 404;
            throw error;
        }

        const activeRound = await roundService.getActiveRound(auction._id);
        let minBid = 1;
        let totalBids = 0;

        if (activeRound) {
            minBid = await roundService.getMinBidForWin(activeRound._id);
            totalBids = await roundService.getTotalBidsCount(activeRound._id);
        }

        return {
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
                minBid: auction.minBid,
                activeRound: activeRound
                    ? {
                        id: activeRound._id,
                        roundNumber: activeRound.roundNumber,
                        startAt: activeRound.startAt,
                        endAt: activeRound.endAt,
                        winnersCount: activeRound.winnersCount,
                        minBidForWin: minBid,
                        totalBids,
                    }
                    : null,
            },
        };
    });

    // Get leaderboard
    app.get('/api/auctions/:id/leaderboard', async (request) => {
        const { id } = validateParams(IdParamsSchema, request.params);
        const { limit } = validateQuery(LeaderboardQuerySchema, request.query);

        const auctionId = new mongoose.Types.ObjectId(id);
        const activeRound = await roundService.getActiveRound(auctionId);

        if (!activeRound) {
            return { success: true, data: [] };
        }

        const leaderboard = await roundService.getRoundLeaderboard(activeRound._id, limit);
        const userIds = leaderboard.map((l) => l.userId);
        const users = await User.find({ _id: { $in: userIds } });
        const userMap = new Map(users.map((u) => [u._id.toString(), u]));

        return {
            success: true,
            data: leaderboard.map((l) => ({
                rank: l.rank,
                userId: l.userId,
                username: userMap.get(l.userId.toString())?.username || 'Unknown',
                amount: l.amount,
            })),
        };
    });

    // Get bids count
    app.get('/api/auctions/:id/bids/count', async (request) => {
        const { id } = validateParams(IdParamsSchema, request.params);
        const auctionId = new mongoose.Types.ObjectId(id);
        const activeRound = await roundService.getActiveRound(auctionId);

        if (!activeRound) {
            return { success: true, data: { count: 0 } };
        }

        const count = await Bid.countDocuments({
            roundId: activeRound._id,
            status: 'active',
        });

        return { success: true, data: { count } };
    });

    // Create auction
    app.post('/api/auctions', async (request) => {
        const input = validateBody(CreateAuctionSchema, request.body);

        const auction = await auctionService.create({
            name: input.name,
            description: input.description,
            totalItems: input.totalItems,
            totalRounds: input.totalRounds,
            winnersPerRound: input.winnersPerRound,
            minBid: input.minBid,
            startAt: input.startAt,
            firstRoundDuration: input.firstRoundDuration,
            otherRoundDuration: input.otherRoundDuration,
        });

        // Schedule auction start via Bull Queue
        await scheduleAuctionStart(auction._id.toString(), auction.startAt);

        return {
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
        };
    });

    // Place bid
    app.post('/api/auctions/:id/bid', { preHandler: authMiddleware }, async (request, reply) => {
        const { id } = validateParams(IdParamsSchema, request.params);
        const { amount } = validateBody(PlaceBidSchema, request.body);
        const auctionId = new mongoose.Types.ObjectId(id);

        // Check auction minBid
        const auction = await Auction.findById(auctionId);
        if (auction && amount < auction.minBid) {
            return reply.status(400).send({
                success: false,
                error: `Minimum bid is ${auction.minBid}`,
            });
        }

        try {
            const result = await bidService.placeBid(request.userId!, auctionId, amount);
            const rank = await bidService.getUserBidRank(request.userId!, auctionId);

            return {
                success: true,
                data: {
                    id: result.bid._id,
                    amount: result.bid.amount,
                    rank,
                    antiSnipingTriggered: result.antiSnipingTriggered,
                },
            };
        } catch (err) {
            return reply.status(400).send({
                success: false,
                error: (err as Error).message,
            });
        }
    });

    // Get my bid
    app.get('/api/auctions/:id/my-bid', { preHandler: authMiddleware }, async (request) => {
        const { id } = validateParams(IdParamsSchema, request.params);
        const auctionId = new mongoose.Types.ObjectId(id);
        const bid = await bidService.getUserBid(request.userId!, auctionId);

        if (!bid) {
            return { success: true, data: null };
        }

        const rank = await bidService.getUserBidRank(request.userId!, auctionId);

        return {
            success: true,
            data: {
                id: bid._id,
                amount: bid.amount,
                rank,
                status: bid.status,
            },
        };
    });
}
