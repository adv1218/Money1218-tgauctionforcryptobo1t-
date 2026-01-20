import mongoose from 'mongoose';
import { Round, Bid, Auction, type IRound } from '../models/index.js';
import { balanceService } from './BalanceService.js';
import { auctionService } from './AuctionService.js';
import { withLock } from '../utils/lock.js';

export class RoundService {
    async getCurrentRound(auctionId: mongoose.Types.ObjectId): Promise<IRound | null> {
        return Round.findOne({
            auctionId,
            status: { $in: ['active', 'pending'] },
        }).sort({ roundNumber: 1 });
    }

    async getActiveRound(auctionId: mongoose.Types.ObjectId): Promise<IRound | null> {
        return Round.findOne({
            auctionId,
            status: 'active',
        });
    }

    async extendForAntiSniping(
        roundId: mongoose.Types.ObjectId,
        extensionMs: number
    ): Promise<void> {
        const round = await Round.findById(roundId);
        if (!round || round.status !== 'active') return;

        const newEndAt = new Date(round.endAt.getTime() + extensionMs);
        round.endAt = newEndAt;
        await round.save();
    }

    async processExpiredRounds(): Promise<void> {
        const now = new Date();
        const expiredRounds = await Round.find({
            status: 'active',
            endAt: { $lte: now },
        });

        for (const round of expiredRounds) {
            await this.processRound(round._id);
        }
    }

    async processRound(roundId: mongoose.Types.ObjectId): Promise<void> {
        await withLock(`round:${roundId}`, async () => {
            const session = await mongoose.startSession();
            session.startTransaction();

            try {
                const round = await Round.findById(roundId).session(session);
                if (!round || round.status !== 'active') {
                    await session.abortTransaction();
                    return;
                }

                round.status = 'processing';
                await round.save({ session });

                const auction = await Auction.findById(round.auctionId).session(session);
                if (!auction) {
                    await session.abortTransaction();
                    return;
                }

                const bids = await Bid.find({
                    roundId: round._id,
                    status: 'active',
                })
                    .sort({ amount: -1, createdAt: 1 })
                    .session(session);

                const winnersCount = Math.min(round.winnersCount, bids.length);
                let totalSpent = 0;
                const baseItemNumber = auction.distributedItems + 1;

                for (let i = 0; i < bids.length; i++) {
                    const bid = bids[i];

                    if (i < winnersCount) {
                        bid.status = 'won';
                        bid.wonInRound = round.roundNumber;
                        bid.itemNumber = baseItemNumber + i;
                        await bid.save({ session });

                        await balanceService.processWin(
                            bid.userId,
                            bid.amount,
                            bid.auctionId,
                            bid._id,
                            session
                        );

                        totalSpent += bid.amount;
                    } else {
                        bid.status = 'refunded';
                        await bid.save({ session });

                        await balanceService.refund(
                            bid.userId,
                            bid.amount,
                            bid.auctionId,
                            bid._id,
                            session
                        );
                    }
                }

                await auctionService.updateStats(
                    auction._id,
                    winnersCount,
                    totalSpent,
                    session
                );

                round.status = 'completed';
                await round.save({ session });

                const remainingItems = auction.totalItems - auction.distributedItems - winnersCount;

                if (remainingItems > 0 && round.roundNumber < auction.totalRounds) {
                    const nextRoundNumber = round.roundNumber + 1;
                    const nextRoundDuration = auction.otherRoundDuration;
                    const nextStart = new Date();
                    const nextEnd = new Date(nextStart.getTime() + nextRoundDuration);

                    const nextWinnersCount = Math.min(
                        auction.itemsPerRound,
                        remainingItems
                    );

                    await Round.create(
                        [
                            {
                                auctionId: auction._id,
                                roundNumber: nextRoundNumber,
                                startAt: nextStart,
                                endAt: nextEnd,
                                originalEndAt: nextEnd,
                                status: 'active',
                                winnersCount: nextWinnersCount,
                            },
                        ],
                        { session }
                    );

                    auction.currentRound = nextRoundNumber;
                    await auction.save({ session });
                } else {
                    await auctionService.completeAuction(auction._id, session);
                }

                await session.commitTransaction();
            } catch (error) {
                await session.abortTransaction();
                throw error;
            } finally {
                session.endSession();
            }
        });
    }

    async getRoundLeaderboard(
        roundId: mongoose.Types.ObjectId,
        limit: number = 10
    ): Promise<{ userId: mongoose.Types.ObjectId; amount: number; rank: number }[]> {
        const bids = await Bid.find({
            roundId,
            status: 'active',
        })
            .sort({ amount: -1, createdAt: 1 })
            .limit(limit)
            .select('userId amount');

        return bids.map((bid, index) => ({
            userId: bid.userId,
            amount: bid.amount,
            rank: index + 1,
        }));
    }

    async getMinBidForWin(roundId: mongoose.Types.ObjectId): Promise<number> {
        const round = await Round.findById(roundId);
        if (!round) return 0;

        const bids = await Bid.find({
            roundId,
            status: 'active',
        })
            .sort({ amount: -1, createdAt: 1 })
            .limit(round.winnersCount)
            .select('amount');

        if (bids.length < round.winnersCount) {
            return 1;
        }

        return bids[bids.length - 1].amount;
    }

    async getTotalBidsCount(roundId: mongoose.Types.ObjectId): Promise<number> {
        return Bid.countDocuments({
            roundId,
            status: 'active',
        });
    }
}

export const roundService = new RoundService();

