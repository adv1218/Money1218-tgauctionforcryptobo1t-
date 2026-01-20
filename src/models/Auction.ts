import mongoose, { Schema, Document } from 'mongoose';

export type AuctionStatus = 'pending' | 'active' | 'completed';

export interface IAuction extends Document {
    _id: mongoose.Types.ObjectId;
    name: string;
    description: string;
    totalItems: number;
    totalRounds: number;
    itemsPerRound: number;
    currentRound: number;
    minBid: number;
    startAt: Date;
    endAt: Date;
    firstRoundDuration: number;
    otherRoundDuration: number;
    antiSnipingExtension: number;
    antiSnipingThreshold: number;
    status: AuctionStatus;
    distributedItems: number;
    avgPrice: number;
    createdAt: Date;
    updatedAt: Date;
}

const auctionSchema = new Schema<IAuction>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            default: '',
        },
        totalItems: {
            type: Number,
            required: true,
            min: 1,
        },
        totalRounds: {
            type: Number,
            required: true,
            min: 1,
        },
        itemsPerRound: {
            type: Number,
            required: true,
            min: 1,
        },
        currentRound: {
            type: Number,
            default: 0,
        },
        minBid: {
            type: Number,
            default: 1,
            min: 1,
        },
        startAt: {
            type: Date,
            required: true,
        },
        endAt: {
            type: Date,
        },
        firstRoundDuration: {
            type: Number,
            required: true,
        },
        otherRoundDuration: {
            type: Number,
            required: true,
        },
        antiSnipingExtension: {
            type: Number,
            default: 30000,
        },
        antiSnipingThreshold: {
            type: Number,
            default: 3,
        },
        status: {
            type: String,
            enum: ['pending', 'active', 'completed'],
            default: 'pending',
        },
        distributedItems: {
            type: Number,
            default: 0,
        },
        avgPrice: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    }
);

auctionSchema.index({ status: 1 });
auctionSchema.index({ startAt: 1 });

export const Auction = mongoose.model<IAuction>('Auction', auctionSchema);
