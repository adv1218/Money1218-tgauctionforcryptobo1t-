import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/index.js';

declare global {
    namespace Express {
        interface Request {
            userId?: mongoose.Types.ObjectId;
        }
    }
}

export async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
        res.status(401).json({ success: false, error: 'User ID required' });
        return;
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        res.status(400).json({ success: false, error: 'Invalid user ID' });
        return;
    }

    const user = await User.findById(userId);
    if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
    }

    req.userId = new mongoose.Types.ObjectId(userId);
    next();
}
