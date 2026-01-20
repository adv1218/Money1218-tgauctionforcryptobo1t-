import mongoose from 'mongoose';
import { config } from './env.js';

export async function connectDatabase(): Promise<void> {
    await mongoose.connect(config.mongodbUri);
    console.log('Connected to MongoDB');
}

export async function disconnectDatabase(): Promise<void> {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
}
