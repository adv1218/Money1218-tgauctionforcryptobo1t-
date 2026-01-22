import mongoose from 'mongoose';
import { Bid, Round, Auction, User, type IBid } from '../models/index.js';
import { balanceService } from './BalanceService.js';
import { roundService } from './RoundService.js';
import { withLock } from '../utils/lock.js';
import { config } from '../config/env.js';
import { emitNewBid, emitAntiSnipe, emitLeaderboardUpdate } from '../websocket/index.js';
import { rescheduleRoundProcessing } from '../jobs/queues.js';

export interface PlaceBidResult {
    bid: IBid;
    antiSnipingTriggered: boolean;
}

export class BidService {
    async placeBid(
        userId: mongoose.Types.ObjectId,
        auctionId: mongoose.Types.ObjectId,
        amount: number
    ): Promise<PlaceBidResult> {
        // Lock per user+auction (allows concurrent bids from different users)
        return withLock(`bid:${auctionId}:${userId}`, async () => {
            const session = await mongoose.startSession();
            session.startTransaction();

            try {
                const auction = await Auction.findById(auctionId).session(session);
                if (!auction || auction.status !== 'active') {
                    throw new Error('Auction not active');
                }

                // Check minimum bid
                if (amount < auction.minBid) {
                    throw new Error(`Minimum bid is ${auction.minBid}`);
                }

                const round = await Round.findOne({
                    auctionId,
                    status: 'active',
                }).session(session);

                if (!round) {
                    throw new Error('No active round');
                }

                // Check if round has expired
                if (new Date() > round.endAt) {
                    throw new Error('Round has ended');
                }

                const user = await User.findById(userId).session(session);
                if (!user) {
                    throw new Error('User not found');
                }

                const existingBid = await Bid.findOne({
                    auctionId,
                    roundId: round._id,
                    userId,
                    status: 'active',
                }).session(session);

                let bid: IBid;

                if (existingBid) {
                    const newAmount = existingBid.amount + amount;

                    if (user.balance < amount) {
                        throw new Error('Insufficient balance');
                    }

                    await balanceService.freeze(
                        userId,
                        amount,
                        auctionId,
                        existingBid._id,
                        session
                    );

                    existingBid.amount = newAmount;
                    await existingBid.save({ session });
                    bid = existingBid;
                } else {
                    if (user.balance < amount) {
                        throw new Error('Insufficient balance');
                    }

                    bid = new Bid({
                        auctionId,
                        roundId: round._id,
                        userId,
                        amount,
                        status: 'active',
                    });

                    await bid.save({ session });

                    await balanceService.freeze(userId, amount, auctionId, bid._id, session);
                }

                const antiSnipingTriggered = await this.checkAntiSniping(
                    round,
                    bid,
                    session
                );

                await session.commitTransaction();

                // Emit WebSocket events after successful transaction
                const totalBids = await Bid.countDocuments({
                    roundId: round._id,
                    status: 'active',
                });

                const rank = await this.getUserBidRank(userId, auctionId);

                // Emit new bid event
                emitNewBid(auctionId.toString(), {
                    rank: rank || 0,
                    amount: bid.amount,
                    userId: userId.toString(),
                    totalBids,
                });

                // Emit anti-snipe event if triggered
                if (antiSnipingTriggered) {
                    const updatedRound = await Round.findById(round._id);
                    if (updatedRound) {
                        emitAntiSnipe(auctionId.toString(), {
                            newEndAt: updatedRound.endAt,
                            extension: config.auction.antiSnipingExtension,
                        });
                    }
                }

                // Emit leaderboard update
                const leaderboard = await roundService.getRoundLeaderboard(round._id, 10);
                const userIds = leaderboard.map((l) => l.userId);
                const users = await User.find({ _id: { $in: userIds } });
                const userMap = new Map(users.map((u) => [u._id.toString(), u]));

                emitLeaderboardUpdate(
                    auctionId.toString(),
                    leaderboard.map((l) => ({
                        rank: l.rank,
                        userId: l.userId.toString(),
                        username: userMap.get(l.userId.toString())?.username || 'Unknown',
                        amount: l.amount,
                    }))
                );

                return { bid, antiSnipingTriggered };
            } catch (error) {
                await session.abortTransaction();
                throw error;
            } finally {
                session.endSession();
            }
        });
    }

    private async checkAntiSniping(
        round: typeof Round.prototype,
        bid: IBid,
        session: mongoose.ClientSession
    ): Promise<boolean> {
        const now = new Date();
        const timeLeft = round.endAt.getTime() - now.getTime();

        if (timeLeft > config.auction.antiSnipingWindow) {
            return false;
        }

        const topBids = await Bid.find({
            roundId: round._id,
            status: 'active',
        })
            .sort({ amount: -1, createdAt: 1 })
            .limit(config.auction.antiSnipingThreshold)
            .session(session);

        const isInTop = topBids.some(
            (b) => b._id.toString() === bid._id.toString()
        );

        if (isInTop) {
            const newEndAt = new Date(round.endAt.getTime() + config.auction.antiSnipingExtension);
            round.endAt = newEndAt;
            await round.save({ session });

            // Reschedule round processing in Bull Queue
            await rescheduleRoundProcessing(round._id.toString(), newEndAt);

            return true;
        }

        return false;
    }

    async getUserBid(
        userId: mongoose.Types.ObjectId,
        auctionId: mongoose.Types.ObjectId
    ): Promise<IBid | null> {
        const round = await roundService.getActiveRound(auctionId);
        if (!round) return null;

        return Bid.findOne({
            auctionId,
            roundId: round._id,
            userId,
            status: 'active',
        });
    }

    async getUserBidRank(
        userId: mongoose.Types.ObjectId,
        auctionId: mongoose.Types.ObjectId
    ): Promise<number | null> {
        const round = await roundService.getActiveRound(auctionId);
        if (!round) return null;

        const userBid = await this.getUserBid(userId, auctionId);
        if (!userBid) return null;

        const higherBids = await Bid.countDocuments({
            roundId: round._id,
            status: 'active',
            $or: [
                { amount: { $gt: userBid.amount } },
                { amount: userBid.amount, createdAt: { $lt: userBid.createdAt } },
            ],
        });

        return higherBids + 1;
    }

    async getUserWins(userId: mongoose.Types.ObjectId): Promise<IBid[]> {
        return Bid.find({
            userId,
            status: 'won',
        }).populate('auctionId');
    }

    async getUserBidHistory(userId: mongoose.Types.ObjectId): Promise<IBid[]> {
        return Bid.find({ userId })
            .sort({ createdAt: -1 })
            .populate('auctionId');
    }
}

export const bidService = new BidService();

