import mongoose from 'mongoose';
import { Auction, Round, type IAuction } from '../models/index.js';
import { config } from '../config/env.js';

export interface CreateAuctionInput {
    name: string;
    description?: string;
    totalItems: number;
    totalRounds: number;
    winnersPerRound?: number;  // Custom winners per round (optional)
    minBid?: number;  // Minimum bid amount (default: 1)
    startAt: Date;
    firstRoundDuration?: number;
    otherRoundDuration?: number;
}

export class AuctionService {
    async create(input: CreateAuctionInput): Promise<IAuction> {
        // If winnersPerRound is provided, use it; otherwise calculate from totalItems/totalRounds
        const itemsPerRound = input.winnersPerRound || Math.ceil(input.totalItems / input.totalRounds);

        const auction = await Auction.create({
            name: input.name,
            description: input.description || '',
            totalItems: input.totalItems,
            totalRounds: input.totalRounds,
            itemsPerRound,
            minBid: input.minBid || 1,
            startAt: input.startAt,
            firstRoundDuration: input.firstRoundDuration || config.auction.defaultFirstRoundDuration,
            otherRoundDuration: input.otherRoundDuration || config.auction.defaultOtherRoundDuration,
            antiSnipingExtension: config.auction.antiSnipingExtension,
            antiSnipingThreshold: config.auction.antiSnipingThreshold,
        });

        return auction;
    }

    async getById(id: mongoose.Types.ObjectId): Promise<IAuction | null> {
        return Auction.findById(id);
    }

    async getAll(): Promise<IAuction[]> {
        return Auction.find().sort({ startAt: -1 });
    }

    async getActive(): Promise<IAuction[]> {
        return Auction.find({ status: 'active' });
    }

    async getPending(): Promise<IAuction[]> {
        const now = new Date();
        return Auction.find({
            status: 'pending',
            startAt: { $lte: now },
        });
    }

    async startAuction(auctionId: mongoose.Types.ObjectId): Promise<IAuction | null> {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const auction = await Auction.findById(auctionId).session(session);
            if (!auction || auction.status !== 'pending') {
                await session.abortTransaction();
                return null;
            }

            const now = new Date();
            const firstRoundEnd = new Date(now.getTime() + auction.firstRoundDuration);

            await Round.create(
                [
                    {
                        auctionId: auction._id,
                        roundNumber: 1,
                        startAt: now,
                        endAt: firstRoundEnd,
                        originalEndAt: firstRoundEnd,
                        status: 'active',
                        winnersCount: Math.min(auction.itemsPerRound, auction.totalItems),
                    },
                ],
                { session }
            );

            auction.status = 'active';
            auction.currentRound = 1;
            await auction.save({ session });

            await session.commitTransaction();
            return auction;
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    async completeAuction(
        auctionId: mongoose.Types.ObjectId,
        session: mongoose.ClientSession
    ): Promise<void> {
        await Auction.findByIdAndUpdate(
            auctionId,
            { status: 'completed' },
            { session }
        );
    }

    async updateStats(
        auctionId: mongoose.Types.ObjectId,
        distributedItems: number,
        totalSpent: number,
        session: mongoose.ClientSession
    ): Promise<void> {
        const auction = await Auction.findById(auctionId).session(session);
        if (!auction) return;

        auction.distributedItems += distributedItems;
        const newTotalSpent = auction.avgPrice * (auction.distributedItems - distributedItems) + totalSpent;
        auction.avgPrice = auction.distributedItems > 0 ? newTotalSpent / auction.distributedItems : 0;
        await auction.save({ session });
    }
}

export const auctionService = new AuctionService();
