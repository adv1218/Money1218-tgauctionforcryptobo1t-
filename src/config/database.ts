import mongoose from 'mongoose';
import { config } from './env.js';

export async function connectDatabase(): Promise<void> {
    // Connection pool settings for better concurrent handling
    await mongoose.connect(config.mongodbUri, {
        maxPoolSize: 50, // Maximum number of connections in pool
        minPoolSize: 10, // Minimum connections to keep open
        maxIdleTimeMS: 30000, // Close idle connections after 30s
        serverSelectionTimeoutMS: 5000, // Timeout for server selection
        socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
        retryWrites: true,
        retryReads: true,
    });

    mongoose.connection.on('error', (err) => {
        console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
        console.log('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
        console.log('MongoDB reconnected');
    });

    console.log('Connected to MongoDB (pool: 10-50)');
}

export async function disconnectDatabase(): Promise<void> {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
}
