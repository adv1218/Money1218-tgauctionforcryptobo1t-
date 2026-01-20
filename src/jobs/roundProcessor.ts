import { auctionService, roundService } from '../services/index.js';

export class RoundProcessor {
    private intervalId: NodeJS.Timeout | null = null;
    private checkInterval: number;

    constructor(checkIntervalMs: number = 1000) {
        this.checkInterval = checkIntervalMs;
    }

    start(): void {
        if (this.intervalId) return;

        this.intervalId = setInterval(async () => {
            try {
                await this.tick();
            } catch (error) {
                console.error('RoundProcessor error:', error);
            }
        }, this.checkInterval);

        console.log('RoundProcessor started');
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('RoundProcessor stopped');
        }
    }

    private async tick(): Promise<void> {
        await this.startPendingAuctions();
        await roundService.processExpiredRounds();
    }

    private async startPendingAuctions(): Promise<void> {
        const pendingAuctions = await auctionService.getPending();

        for (const auction of pendingAuctions) {
            try {
                await auctionService.startAuction(auction._id);
                console.log(`Started auction: ${auction.name}`);
            } catch (error) {
                console.error(`Failed to start auction ${auction._id}:`, error);
            }
        }
    }
}

export const roundProcessor = new RoundProcessor(200);  // Check every 200ms for faster round transitions

