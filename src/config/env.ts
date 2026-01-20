import 'dotenv/config';

export const config = {
    port: parseInt(process.env.PORT || '3000', 10),
    mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/crypto-auction',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    nodeEnv: process.env.NODE_ENV || 'development',

    auction: {
        defaultFirstRoundDuration: 20 * 60 * 1000,
        defaultOtherRoundDuration: 3 * 60 * 1000,
        antiSnipingExtension: 30 * 1000,
        antiSnipingThreshold: 3,
        antiSnipingWindow: 30 * 1000,
    },
};
