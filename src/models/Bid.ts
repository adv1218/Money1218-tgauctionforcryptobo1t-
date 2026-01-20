import mongoose, { Schema, Document } from 'mongoose';

export type BidStatus = 'active' | 'won' | 'refunded';

export interface IBid extends Document {
    _id: mongoose.Types.ObjectId;
    auctionId: mongoose.Types.ObjectId;
    roundId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    amount: number;
    status: BidStatus;
    wonInRound: number | null;
    itemNumber: number | null;
    createdAt: Date;
    updatedAt: Date;
}

const bidSchema = new Schema<IBid>(
    {
        auctionId: {
            type: Schema.Types.ObjectId,
            ref: 'Auction',
            required: true,
        },
        roundId: {
            type: Schema.Types.ObjectId,
            ref: 'Round',
            required: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 1,
        },
        status: {
            type: String,
            enum: ['active', 'won', 'refunded'],
            default: 'active',
        },
        wonInRound: {
            type: Number,
            default: null,
        },
        itemNumber: {
            type: Number,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

bidSchema.index({ auctionId: 1, roundId: 1, userId: 1 }, { unique: true });
bidSchema.index({ roundId: 1, status: 1, amount: -1 });
bidSchema.index({ userId: 1, status: 1 });

export const Bid = mongoose.model<IBid>('Bid', bidSchema);
