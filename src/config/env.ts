import 'dotenv/config';

export const config = {
    port: parseInt(process.env.PORT || '3000', 10),
    mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/crypto-auction',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    nodeEnv: process.env.NODE_ENV || 'development',

    auction: {
        defaultFirstRoundDuration: 20 * 60 * 1000,
        defaultOtherRoundDuration: 3 * 60 * 1000,
        antiSnipingExtension: 30 * 1000, // Add 30 seconds when anti-sniping triggered
        antiSnipingThreshold: 3, // Number of times anti-sniping can trigger
        antiSnipingWindow: 5 * 1000, // Only trigger anti-sniping if bid in last 5 seconds
    },
};
