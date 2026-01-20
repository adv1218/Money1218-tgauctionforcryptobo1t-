import mongoose, { Schema, Document } from 'mongoose';

export type TransactionType = 'deposit' | 'freeze' | 'unfreeze' | 'win' | 'refund';

export interface ITransaction extends Document {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    type: TransactionType;
    amount: number;
    auctionId: mongoose.Types.ObjectId | null;
    bidId: mongoose.Types.ObjectId | null;
    balanceBefore: number;
    balanceAfter: number;
    createdAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        type: {
            type: String,
            enum: ['deposit', 'freeze', 'unfreeze', 'win', 'refund'],
            required: true,
        },
        amount: {
            type: Number,
            required: true,
        },
        auctionId: {
            type: Schema.Types.ObjectId,
            ref: 'Auction',
            default: null,
        },
        bidId: {
            type: Schema.Types.ObjectId,
            ref: 'Bid',
            default: null,
        },
        balanceBefore: {
            type: Number,
            required: true,
        },
        balanceAfter: {
            type: Number,
            required: true,
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
    }
);

transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ auctionId: 1 });

export const Transaction = mongoose.model<ITransaction>('Transaction', transactionSchema);
