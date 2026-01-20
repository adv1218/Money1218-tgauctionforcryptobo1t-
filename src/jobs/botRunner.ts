import mongoose from 'mongoose';
import { User, Auction } from '../models/index.js';
import { bidService, roundService } from '../services/index.js';

interface BotConfig {
    count: number;
    minBid: number;
    maxBid: number;
    intervalMs: number;
}

export class BotRunner {
    private bots: mongoose.Types.ObjectId[] = [];
    private intervalId: NodeJS.Timeout | null = null;
    private config: BotConfig;

    constructor(config: BotConfig) {
        this.config = config;
    }

    async initialize(): Promise<void> {
        for (let i = 0; i < this.config.count; i++) {
            const username = `bot_${Date.now()}_${i}`;
            const user = await User.create({
                username,
                balance: 1000000,
                frozenBalance: 0,
            });
            this.bots.push(user._id);
        }
        console.log(`Initialized ${this.bots.length} bots`);
    }

    start(): void {
        if (this.intervalId) return;

        this.intervalId = setInterval(async () => {
            try {
                await this.tick();
            } catch (error) {
                console.error('BotRunner error:', error);
            }
        }, this.config.intervalMs);

        console.log('BotRunner started');
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('BotRunner stopped');
        }
    }

    private async tick(): Promise<void> {
        const activeAuctions = await Auction.find({ status: 'active' });

        for (const auction of activeAuctions) {
            const activeRound = await roundService.getActiveRound(auction._id);
            if (!activeRound) continue;

            const botIndex = Math.floor(Math.random() * this.bots.length);
            const botId = this.bots[botIndex];

            const existingBid = await bidService.getUserBid(botId, auction._id);
            const minAmount = existingBid ? existingBid.amount + 1 : this.config.minBid;
            const amount = minAmount + Math.floor(Math.random() * (this.config.maxBid - minAmount));

            try {
                await bidService.placeBid(botId, auction._id, amount);
            } catch {
                // ignore errors
            }
        }
    }
}

export async function runBots(config: BotConfig): Promise<BotRunner> {
    const runner = new BotRunner(config);
    await runner.initialize();
    runner.start();
    return runner;
}
