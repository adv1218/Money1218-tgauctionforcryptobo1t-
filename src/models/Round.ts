import mongoose, { Schema, Document } from 'mongoose';

export type RoundStatus = 'pending' | 'active' | 'processing' | 'completed';

export interface IRound extends Document {
    _id: mongoose.Types.ObjectId;
    auctionId: mongoose.Types.ObjectId;
    roundNumber: number;
    startAt: Date;
    endAt: Date;
    originalEndAt: Date;
    status: RoundStatus;
    winnersCount: number;
    createdAt: Date;
    updatedAt: Date;
}

const roundSchema = new Schema<IRound>(
    {
        auctionId: {
            type: Schema.Types.ObjectId,
            ref: 'Auction',
            required: true,
        },
        roundNumber: {
            type: Number,
            required: true,
            min: 1,
        },
        startAt: {
            type: Date,
            required: true,
        },
        endAt: {
            type: Date,
            required: true,
        },
        originalEndAt: {
            type: Date,
            required: true,
        },
        status: {
            type: String,
            enum: ['pending', 'active', 'processing', 'completed'],
            default: 'pending',
        },
        winnersCount: {
            type: Number,
            required: true,
            min: 0,
        },
    },
    {
        timestamps: true,
    }
);

roundSchema.index({ auctionId: 1, roundNumber: 1 }, { unique: true });
roundSchema.index({ auctionId: 1, status: 1 });
roundSchema.index({ endAt: 1, status: 1 });

export const Round = mongoose.model<IRound>('Round', roundSchema);
