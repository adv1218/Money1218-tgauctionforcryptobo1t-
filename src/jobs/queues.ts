import Bull from 'bull';
import { config } from '../config/env.js';
import { roundService } from '../services/RoundService.js';
import { auctionService } from '../services/AuctionService.js';
import mongoose from 'mongoose';

// Redis options for Bull (supports TLS for rediss://)
const redisOptions: Bull.QueueOptions['redis'] = config.redisUrl.startsWith('rediss://')
    ? {
        tls: {},
        maxRetriesPerRequest: null,
    }
    : {
        maxRetriesPerRequest: null,
    };

// Round processing queue
export const roundQueue = new Bull('round-processing', config.redisUrl, {
    redis: redisOptions,
    defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 10,
        backoff: {
            type: 'exponential',
            delay: 2000,
        },
    },
});

// Auction start queue
export const auctionStartQueue = new Bull('auction-start', config.redisUrl, {
    redis: redisOptions,
    defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
    },
});

// Schedule round processing
export async function scheduleRoundProcessing(roundId: string, endAt: Date): Promise<void> {
    const delay = Math.max(0, endAt.getTime() - Date.now());

    console.log(`[Bull] Scheduling round ${roundId} processing in ${delay}ms (endAt: ${endAt.toISOString()})`);

    const job = await roundQueue.add(
        'process-round',
        { roundId },
        {
            delay,
            jobId: `round-${roundId}`,
        }
    );

    console.log(`[Bull] Round job added: id=${job.id}, roundId=${roundId}, delay=${delay}ms`);

    // Log queue status
    const jobCounts = await roundQueue.getJobCounts();
    console.log(`[Bull] Queue status: waiting=${jobCounts.waiting}, active=${jobCounts.active}, delayed=${jobCounts.delayed}`);
}

// Reschedule round (for anti-sniping)
export async function rescheduleRoundProcessing(roundId: string, newEndAt: Date): Promise<void> {
    console.log(`[Bull] Rescheduling round ${roundId} to ${newEndAt.toISOString()}`);

    // Remove existing job
    const existingJob = await roundQueue.getJob(`round-${roundId}`);
    if (existingJob) {
        await existingJob.remove();
        console.log(`[Bull] Removed existing job for round ${roundId}`);
    }

    // Schedule new job
    await scheduleRoundProcessing(roundId, newEndAt);
}

// Schedule auction start
export async function scheduleAuctionStart(auctionId: string, startAt: Date): Promise<void> {
    const delay = Math.max(0, startAt.getTime() - Date.now());

    await auctionStartQueue.add(
        'start-auction',
        { auctionId },
        {
            delay,
            jobId: `auction-${auctionId}`,
        }
    );

    console.log(`[Bull] Scheduled auction ${auctionId} start in ${delay}ms`);
}

// Initialize queues with processors and error handlers
export function initializeQueues(): void {
    console.log('[Bull] Initializing queues...');

    // Register round processor
    roundQueue.process('process-round', async (job) => {
        const { roundId } = job.data;
        console.log(`[Bull] Processing round: ${roundId}`);

        try {
            await roundService.processRound(new mongoose.Types.ObjectId(roundId));
            console.log(`[Bull] Round processed successfully: ${roundId}`);
        } catch (error) {
            console.error(`[Bull] Failed to process round ${roundId}:`, error);
            throw error;
        }
    });
    console.log('[Bull] Round processor registered');

    // Register auction start processor
    auctionStartQueue.process('start-auction', async (job) => {
        const { auctionId } = job.data;
        console.log(`[Bull] Starting auction: ${auctionId}`);

        try {
            await auctionService.startAuction(new mongoose.Types.ObjectId(auctionId));
            console.log(`[Bull] Auction started successfully: ${auctionId}`);
        } catch (error) {
            console.error(`[Bull] Failed to start auction ${auctionId}:`, error);
            throw error;
        }
    });
    console.log('[Bull] Auction start processor registered');

    // Error handlers
    roundQueue.on('error', (error) => {
        console.error('[Bull] Round queue error:', error);
    });

    roundQueue.on('failed', (job, error) => {
        console.error(`[Bull] Round job ${job.id} failed:`, error);
    });

    roundQueue.on('completed', (job) => {
        console.log(`[Bull] Round job ${job.id} completed`);
    });

    roundQueue.on('stalled', (job) => {
        console.warn(`[Bull] Round job ${job.id} stalled`);
    });

    auctionStartQueue.on('error', (error) => {
        console.error('[Bull] Auction start queue error:', error);
    });

    auctionStartQueue.on('failed', (job, error) => {
        console.error(`[Bull] Auction start job ${job.id} failed:`, error);
    });

    auctionStartQueue.on('completed', (job) => {
        console.log(`[Bull] Auction start job ${job.id} completed`);
    });

    console.log('[Bull] Queues initialized');
}

// Graceful shutdown
export async function closeQueues(): Promise<void> {
    await roundQueue.close();
    await auctionStartQueue.close();
    console.log('[Bull] Queues closed');
}
