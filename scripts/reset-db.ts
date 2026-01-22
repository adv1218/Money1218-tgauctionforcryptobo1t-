import mongoose from 'mongoose';
import { config } from '../src/config/env.js';
import { User, Auction, Bid, Round, Transaction } from '../src/models/index.js';
import { redis } from '../src/config/redis.js';

async function resetDb() {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(config.mongodbUri);
    console.log('Connected.');

    if (config.nodeEnv === 'production') {
        console.error('❌ SAFETY: Cannot reset DB in production mode!');
        process.exit(1);
    }

    console.log('🗑️  Clearing all data...');

    await Promise.all([
        User.deleteMany({}),
        Auction.deleteMany({}),
        Bid.deleteMany({}),
        Round.deleteMany({}),
        Transaction.deleteMany({}),
    ]);

    console.log('✅ MongoDB cleared');

    console.log('🗑️  Clearing Redis keys...');
    const keys = await redis.keys('*');
    if (keys.length > 0) {
        await redis.del(keys);
    }
    console.log('✅ Redis cleared');

    await mongoose.disconnect();
    redis.disconnect();
    console.log('✨ Done');
}

resetDb().catch(console.error);
