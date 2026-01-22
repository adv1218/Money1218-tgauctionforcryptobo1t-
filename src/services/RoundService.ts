import mongoose from 'mongoose';
import { Round, Bid, Auction, type IRound } from '../models/index.js';
import { balanceService } from './BalanceService.js';
import { auctionService } from './AuctionService.js';
import { withLock } from '../utils/lock.js';
import { emitRoundEnd, emitRoundStart, emitAuctionComplete } from '../websocket/index.js';
import { scheduleRoundProcessing } from '../jobs/queues.js';

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

    /**
     * Optimized processRound without transactions for better performance on cloud MongoDB
     * Uses atomic operations and distributed locking instead
     */
    async processRound(roundId: mongoose.Types.ObjectId): Promise<void> {
        await withLock(`round:${roundId}`, async () => {
            console.log(`[RoundService] Starting to process round ${roundId}`);

            // Atomically set round to 'processing' and get the round
            const round = await Round.findOneAndUpdate(
                { _id: roundId, status: 'active' },
                { $set: { status: 'processing' } },
                { new: true }
            );

            if (!round) {
                console.log(`[RoundService] Round ${roundId} is not active, skipping`);
                return;
            }

            console.log(`[RoundService] Round ${roundId} set to processing`);

            const auction = await Auction.findById(round.auctionId);
            if (!auction) {
                await Round.updateOne({ _id: roundId }, { $set: { status: 'active' } });
                return;
            }

            const auctionId = auction._id.toString();

            // Get bids sorted by amount (highest first), then by time (earliest first)
            const bids = await Bid.find({
                roundId: round._id,
                status: 'active',
            })
                .sort({ amount: -1, createdAt: 1 })
                .lean();

            console.log(`[RoundService] Found ${bids.length} active bids`);

            const winnersCount = Math.min(round.winnersCount, bids.length);
            let totalSpent = 0;
            const baseItemNumber = auction.distributedItems + 1;

            // Process winners and losers in parallel for speed
            const winnerPromises: Promise<void>[] = [];
            const loserPromises: Promise<void>[] = [];

            for (let i = 0; i < bids.length; i++) {
                const bid = bids[i];

                if (i < winnersCount) {
                    totalSpent += bid.amount;
                    winnerPromises.push(
                        (async () => {
                            await Bid.updateOne(
                                { _id: bid._id },
                                {
                                    $set: {
                                        status: 'won',
                                        wonInRound: round.roundNumber,
                                        itemNumber: baseItemNumber + i,
                                    },
                                }
                            );
                            await balanceService.processWinWithoutSession(
                                bid.userId,
                                bid.amount,
                                bid.auctionId,
                                bid._id
                            );
                        })()
                    );
                } else {
                    loserPromises.push(
                        (async () => {
                            await Bid.updateOne(
                                { _id: bid._id },
                                { $set: { status: 'refunded' } }
                            );
                            await balanceService.refundWithoutSession(
                                bid.userId,
                                bid.amount,
                                bid.auctionId,
                                bid._id
                            );
                        })()
                    );
                }
            }

            // Wait for all operations to complete
            await Promise.all([...winnerPromises, ...loserPromises]);

            console.log(`[RoundService] Processed ${winnersCount} winners, ${bids.length - winnersCount} refunds`);

            // Update auction stats
            await Auction.updateOne(
                { _id: auction._id },
                {
                    $inc: { distributedItems: winnersCount },
                    $set: {
                        avgPrice: auction.distributedItems + winnersCount > 0
                            ? (auction.avgPrice * auction.distributedItems + totalSpent) / (auction.distributedItems + winnersCount)
                            : 0,
                    },
                }
            );

            // Mark round as completed
            await Round.updateOne({ _id: roundId }, { $set: { status: 'completed' } });

            // Emit round end event
            emitRoundEnd(auctionId, {
                roundNumber: round.roundNumber,
                winnersCount,
            });

            const remainingItems = auction.totalItems - auction.distributedItems - winnersCount;

            if (remainingItems > 0 && round.roundNumber < auction.totalRounds) {
                // Create next round
                const nextRoundNumber = round.roundNumber + 1;
                const nextRoundDuration = auction.otherRoundDuration;
                const nextStart = new Date();
                const nextEnd = new Date(nextStart.getTime() + nextRoundDuration);

                const nextWinnersCount = Math.min(auction.itemsPerRound, remainingItems);

                const newRound = await Round.create({
                    auctionId: auction._id,
                    roundNumber: nextRoundNumber,
                    startAt: nextStart,
                    endAt: nextEnd,
                    originalEndAt: nextEnd,
                    status: 'active',
                    winnersCount: nextWinnersCount,
                });

                await Auction.updateOne(
                    { _id: auction._id },
                    { $set: { currentRound: nextRoundNumber } }
                );

                // Schedule next round processing
                await scheduleRoundProcessing(newRound._id.toString(), nextEnd);

                // Emit new round start event
                emitRoundStart(auctionId, {
                    roundNumber: nextRoundNumber,
                    endAt: nextEnd,
                    winnersCount: nextWinnersCount,
                });

                console.log(`[RoundService] Created next round ${nextRoundNumber}`);
            } else {
                // Complete auction
                await Auction.updateOne(
                    { _id: auction._id },
                    { $set: { status: 'completed' } }
                );

                emitAuctionComplete(auctionId);
                console.log(`[RoundService] Auction completed`);
            }

            console.log(`[RoundService] Round ${roundId} processed successfully`);
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
