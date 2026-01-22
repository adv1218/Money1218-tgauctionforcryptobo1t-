import { z } from 'zod';

// MongoDB ObjectId validation
export const ObjectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

// User schemas
export const LoginSchema = z.object({
    username: z.string().min(1, 'Username required').max(50, 'Username too long').trim(),
});

export const DepositSchema = z.object({
    amount: z.number().int().min(1, 'Amount must be at least 1'),
});

// Auction schemas
export const CreateAuctionSchema = z.object({
    name: z.string().min(1, 'Name required').max(100, 'Name too long').trim(),
    description: z.string().max(500).optional().default(''),
    totalItems: z.number().int().min(1, 'At least 1 item required'),
    totalRounds: z.number().int().min(1, 'At least 1 round required'),
    winnersPerRound: z.number().int().min(1).optional(),
    minBid: z.number().int().min(1).optional().default(1),
    startAt: z.coerce.date().refine(
        (date) => date > new Date(),
        'Start time must be in the future'
    ),
    firstRoundDuration: z.number().int().min(1000).optional(),
    otherRoundDuration: z.number().int().min(1000).optional(),
});

export const PlaceBidSchema = z.object({
    amount: z.number().int().min(1, 'Amount must be at least 1'),
});

// Params schemas
export const IdParamsSchema = z.object({
    id: ObjectIdSchema,
});

export const LeaderboardQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
});

// Types inferred from schemas
export type LoginInput = z.infer<typeof LoginSchema>;
export type DepositInput = z.infer<typeof DepositSchema>;
export type CreateAuctionInput = z.infer<typeof CreateAuctionSchema>;
export type PlaceBidInput = z.infer<typeof PlaceBidSchema>;
export type IdParams = z.infer<typeof IdParamsSchema>;
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;
