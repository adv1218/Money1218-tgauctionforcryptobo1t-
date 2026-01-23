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
     * Process round with ACID transactions (Replica Set required)
     * Secure processing of financial data
     */
    async processRound(roundId: mongoose.Types.ObjectId): Promise<void> {
        await withLock(`round:${roundId}`, async () => {
            console.log(`[RoundService] Starting to process round ${roundId}`);

            const session = await mongoose.startSession();
            session.startTransaction();

            try {
                // Lock round for processing inside transaction
                const round = await Round.findOneAndUpdate(
                    { _id: roundId, status: 'active' },
                    { $set: { status: 'processing' } },
                    { new: true, session }
                );

                if (!round) {
                    console.log(`[RoundService] Round ${roundId} is not active, skipping`);
                    await session.abortTransaction();
                    return;
                }

                console.log(`[RoundService] Round ${roundId} set to processing`);

                const auction = await Auction.findById(round.auctionId).session(session);
                if (!auction) {
                    // Revert status if auction missing
                    await Round.updateOne({ _id: roundId }, { $set: { status: 'active' } }, { session });
                    await session.commitTransaction();
                    return;
                }

                const auctionId = auction._id.toString();

                // Get bids sorted by amount (highest first), then by time (earliest first)
                const bids = await Bid.find({
                    roundId: round._id,
                    status: 'active',
                })
                    .sort({ amount: -1, createdAt: 1 })
                    .session(session)
                    .lean(); // lean cannot be used with save(), but ok for read

                console.log(`[RoundService] Found ${bids.length} active bids`);

                const winnersCount = Math.min(round.winnersCount, bids.length);
                let totalSpent = 0;
                const baseItemNumber = auction.distributedItems + 1;

                // Process all bids sequentially within transaction (promises parallel but in one transaction)
                const processingPromises: Promise<void>[] = [];

                for (let i = 0; i < bids.length; i++) {
                    const bid = bids[i];

                    if (i < winnersCount) {
                        totalSpent += bid.amount;
                        processingPromises.push(
                            (async () => {
                                await Bid.updateOne(
                                    { _id: bid._id },
                                    {
                                        $set: {
                                            status: 'won',
                                            wonInRound: round.roundNumber,
                                            itemNumber: baseItemNumber + i,
                                        },
                                    },
                                    { session }
                                );
                                await balanceService.processWin(
                                    bid.userId,
                                    bid.amount,
                                    bid.auctionId,
                                    bid._id,
                                    session
                                );
                            })()
                        );
                    } else {
                        processingPromises.push(
                            (async () => {
                                await Bid.updateOne(
                                    { _id: bid._id },
                                    { $set: { status: 'refunded' } },
                                    { session }
                                );
                                await balanceService.refund(
                                    bid.userId,
                                    bid.amount,
                                    bid.auctionId,
                                    bid._id,
                                    session
                                );
                            })()
                        );
                    }
                }

                // Wait for all balance operations
                await Promise.all(processingPromises);

                console.log(`[RoundService] Processed ${winnersCount} winners, ${bids.length - winnersCount} refunds`);

                // Update auction stats
                const newDistributedItems = auction.distributedItems + winnersCount;
                const newAvgPrice = newDistributedItems > 0
                    ? (auction.avgPrice * auction.distributedItems + totalSpent) / newDistributedItems
                    : 0;

                await Auction.updateOne(
                    { _id: auction._id },
                    {
                        $set: {
                            distributedItems: newDistributedItems,
                            avgPrice: newAvgPrice,
                        },
                    },
                    { session }
                );

                // Mark round as completed
                await Round.updateOne({ _id: roundId }, { $set: { status: 'completed' } }, { session });

                // Prepare next round creation (if needed)
                const remainingItems = auction.totalItems - newDistributedItems;
                let nextRoundInfo = null;
                let isAuctionCompleted = false;

                if (remainingItems > 0 && round.roundNumber < auction.totalRounds) {
                    // Create next round
                    const nextRoundNumber = round.roundNumber + 1;
                    const nextRoundDuration = auction.otherRoundDuration;
                    const nextStart = new Date();
                    const nextEnd = new Date(nextStart.getTime() + nextRoundDuration);

                    const nextWinnersCount = Math.min(auction.itemsPerRound, remainingItems);

                    const newRound = await Round.create(
                        [{
                            auctionId: auction._id,
                            roundNumber: nextRoundNumber,
                            startAt: nextStart,
                            endAt: nextEnd,
                            originalEndAt: nextEnd,
                            status: 'active',
                            winnersCount: nextWinnersCount,
                        }],
                        { session }
                    );

                    await Auction.updateOne(
                        { _id: auction._id },
                        { $set: { currentRound: nextRoundNumber } },
                        { session }
                    );

                    nextRoundInfo = {
                        id: newRound[0]._id,
                        roundNumber: nextRoundNumber,
                        endAt: nextEnd,
                        winnersCount: nextWinnersCount
                    };
                } else {
                    // Complete auction
                    await Auction.updateOne(
                        { _id: auction._id },
                        { $set: { status: 'completed' } },
                        { session }
                    );
                    isAuctionCompleted = true;
                }

                // COMMIT TRANSACTION
                await session.commitTransaction();
                console.log(`[RoundService] Transaction committed for round ${roundId}`);

                // AFTER COMMIT - Side effects (Events, Jobs)
                emitRoundEnd(auctionId, {
                    roundNumber: round.roundNumber,
                    winnersCount,
                });

                if (nextRoundInfo) {
                    await scheduleRoundProcessing(nextRoundInfo.id.toString(), nextRoundInfo.endAt);

                    emitRoundStart(auctionId, {
                        roundNumber: nextRoundInfo.roundNumber,
                        endAt: nextRoundInfo.endAt,
                        winnersCount: nextRoundInfo.winnersCount,
                    });
                    console.log(`[RoundService] Created next round ${nextRoundInfo.roundNumber}`);
                }

                if (isAuctionCompleted) {
                    emitAuctionComplete(auctionId);
                    console.log(`[RoundService] Auction completed`);
                }

            } catch (error) {
                console.error(`[RoundService] Error processing round ${roundId}:`, error);
                await session.abortTransaction();

                // Reset round status to active to retry later (or manual intervention)
                // We do this outside the aborted transaction
                try {
                    await Round.updateOne({ _id: roundId }, { $set: { status: 'active' } });
                } catch (e) {
                    console.error('Failed to reset round status:', e);
                }
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
