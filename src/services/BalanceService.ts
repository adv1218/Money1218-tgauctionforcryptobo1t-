import mongoose from 'mongoose';
import { User, Transaction, type IUser } from '../models/index.js';

export class BalanceService {
    async getUser(userId: mongoose.Types.ObjectId): Promise<IUser | null> {
        return User.findById(userId);
    }

    async deposit(
        userId: mongoose.Types.ObjectId,
        amount: number,
        session?: mongoose.ClientSession
    ): Promise<IUser> {
        const user = await User.findById(userId).session(session ?? null);
        if (!user) throw new Error('User not found');

        const balanceBefore = user.balance;
        user.balance += amount;
        await user.save({ session });

        await Transaction.create(
            [
                {
                    userId,
                    type: 'deposit',
                    amount,
                    balanceBefore,
                    balanceAfter: user.balance,
                },
            ],
            { session }
        );

        return user;
    }

    async freeze(
        userId: mongoose.Types.ObjectId,
        amount: number,
        auctionId: mongoose.Types.ObjectId,
        bidId: mongoose.Types.ObjectId,
        session: mongoose.ClientSession
    ): Promise<void> {
        const user = await User.findById(userId).session(session);
        if (!user) throw new Error('User not found');
        if (user.balance < amount) throw new Error('Insufficient balance');

        const balanceBefore = user.balance;
        user.balance -= amount;
        user.frozenBalance += amount;
        await user.save({ session });

        await Transaction.create(
            [
                {
                    userId,
                    type: 'freeze',
                    amount,
                    auctionId,
                    bidId,
                    balanceBefore,
                    balanceAfter: user.balance,
                },
            ],
            { session }
        );
    }

    async unfreeze(
        userId: mongoose.Types.ObjectId,
        amount: number,
        auctionId: mongoose.Types.ObjectId,
        bidId: mongoose.Types.ObjectId,
        session: mongoose.ClientSession
    ): Promise<void> {
        const user = await User.findById(userId).session(session);
        if (!user) throw new Error('User not found');
        if (user.frozenBalance < amount) throw new Error('Insufficient frozen balance');

        const balanceBefore = user.balance;
        user.frozenBalance -= amount;
        user.balance += amount;
        await user.save({ session });

        await Transaction.create(
            [
                {
                    userId,
                    type: 'unfreeze',
                    amount,
                    auctionId,
                    bidId,
                    balanceBefore,
                    balanceAfter: user.balance,
                },
            ],
            { session }
        );
    }

    async processWin(
        userId: mongoose.Types.ObjectId,
        amount: number,
        auctionId: mongoose.Types.ObjectId,
        bidId: mongoose.Types.ObjectId,
        session: mongoose.ClientSession
    ): Promise<void> {
        const user = await User.findById(userId).session(session);
        if (!user) throw new Error('User not found');
        if (user.frozenBalance < amount) throw new Error('Insufficient frozen balance');

        const balanceBefore = user.balance;
        user.frozenBalance -= amount;
        await user.save({ session });

        await Transaction.create(
            [
                {
                    userId,
                    type: 'win',
                    amount,
                    auctionId,
                    bidId,
                    balanceBefore,
                    balanceAfter: user.balance,
                },
            ],
            { session }
        );
    }

    async refund(
        userId: mongoose.Types.ObjectId,
        amount: number,
        auctionId: mongoose.Types.ObjectId,
        bidId: mongoose.Types.ObjectId,
        session: mongoose.ClientSession
    ): Promise<void> {
        const user = await User.findById(userId).session(session);
        if (!user) throw new Error('User not found');
        if (user.frozenBalance < amount) throw new Error('Insufficient frozen balance');

        const balanceBefore = user.balance;
        user.frozenBalance -= amount;
        user.balance += amount;
        await user.save({ session });

        await Transaction.create(
            [
                {
                    userId,
                    type: 'refund',
                    amount,
                    auctionId,
                    bidId,
                    balanceBefore,
                    balanceAfter: user.balance,
                },
            ],
            { session }
        );
    }
}

export const balanceService = new BalanceService();
