import mongoose from 'mongoose';
import { Bid, Round, Auction, User, type IBid } from '../models/index.js';
import { balanceService } from './BalanceService.js';
import { roundService } from './RoundService.js';
import { withLock } from '../utils/lock.js';
import { config } from '../config/env.js';

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
        return withLock(`auction:${auctionId}`, async () => {
            const session = await mongoose.startSession();
            session.startTransaction();

            try {
                const auction = await Auction.findById(auctionId).session(session);
                if (!auction || auction.status !== 'active') {
                    throw new Error('Auction not active');
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
                let freezeAmount: number;

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
            round.endAt = new Date(round.endAt.getTime() + config.auction.antiSnipingExtension);
            await round.save({ session });
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
