import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/database.js';
import { auctionService } from '../../src/services/AuctionService.js';
import { bidService, roundService } from '../../src/services/index.js';
import { roundProcessor } from '../../src/jobs/roundProcessor.js';
import { Bid, User, Auction } from '../../src/models/index.js';

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log('Starting SINGLE BID load test...\n');
    console.log('Each bot places ONE random bid per round (no updates)\n');

    await connectDatabase();

    // Create 100 bots
    const bots: mongoose.Types.ObjectId[] = [];
    console.log('Creating 100 bots...');
    for (let i = 0; i < 100; i++) {
        const user = await User.create({
            username: `bot_single_${Date.now()}_${i}`,
            balance: 1000000,
            frozenBalance: 0,
        });
        bots.push(user._id);
    }
    console.log(`Created ${bots.length} bots`);

    const startDate = new Date(Date.now() + 5000);

    const auction = await auctionService.create({
        name: 'Single Bid Test Auction',
        totalItems: 30,
        totalRounds: 3,
        startAt: startDate,
        firstRoundDuration: 30000,  // 30 sec (longer to allow all bots to bid)
        otherRoundDuration: 20000,  // 20 sec
    });

    console.log(`\nCreated auction: ${auction.name}`);
    console.log(`Items: ${auction.totalItems}, Rounds: ${auction.totalRounds}`);
    console.log(`Winners per round: ${auction.itemsPerRound}`);
    console.log(`Starting at: ${startDate.toISOString()}\n`);

    // Wait for auction to start
    console.log('Waiting for auction to start...');
    await sleep(6000);

    roundProcessor.start();

    let lastRoundId: string | null = null;

    const placeBidsForRound = async (roundId: string) => {
        console.log(`\nPlacing bids for round (${roundId.slice(-6)})...`);

        let placed = 0;
        for (const botId of bots) {
            const amount = 100 + Math.floor(Math.random() * 900); // 100-1000

            try {
                await bidService.placeBid(botId, auction._id, amount);
                placed++;
                // Small delay to avoid overwhelming the DB with concurrent transactions
                await sleep(50);
            } catch {
                // ignore errors (insufficient balance etc)
            }
        }
        console.log(`Placed ${placed} bids`);
    };

    console.log('\nWaiting for auction to complete...\n');

    // Main loop - check for new rounds and auction completion
    await new Promise<void>((resolve) => {
        const checkInterval = setInterval(async () => {
            const a = await Auction.findById(auction._id);

            if (a?.status === 'completed') {
                clearInterval(checkInterval);
                resolve();
                return;
            }

            if (a?.status !== 'active') return;

            const activeRound = await roundService.getActiveRound(auction._id);
            if (!activeRound) return;

            const currentRoundId = activeRound._id.toString();

            // If this is a NEW round, place bids
            if (currentRoundId !== lastRoundId) {
                lastRoundId = currentRoundId;
                console.log(`\n=== Round ${activeRound.roundNumber} started ===`);
                await placeBidsForRound(currentRoundId);
            }
        }, 1000);
    });

    roundProcessor.stop();

    console.log('\n=== RESULTS ===\n');

    const finalAuction = await Auction.findById(auction._id);
    console.log(`Distributed items: ${finalAuction?.distributedItems}`);
    console.log(`Average price: ${Math.round(finalAuction?.avgPrice || 0)} stars`);

    const winners = await Bid.find({ auctionId: auction._id, status: 'won' }).sort({ itemNumber: 1 });
    console.log(`\nWinners: ${winners.length}`);

    const refunded = await Bid.countDocuments({ auctionId: auction._id, status: 'refunded' });
    console.log(`Refunded bids: ${refunded}`);

    const totalSpent = winners.reduce((sum, b) => sum + b.amount, 0);
    console.log(`\nTotal spent: ${totalSpent} stars`);

    // Financial integrity check
    const users = await User.find({ username: /^bot_single_/ });
    const totalBalance = users.reduce((sum, u) => sum + u.balance + u.frozenBalance, 0);
    const expectedTotal = users.length * 1000000;
    const diff = expectedTotal - totalSpent - totalBalance;

    console.log(`\nBalance check:`);
    console.log(`  Expected total: ${expectedTotal}`);
    console.log(`  Total spent: ${totalSpent}`);
    console.log(`  Remaining balance: ${totalBalance}`);
    console.log(`  Difference: ${diff} (should be 0)`);

    if (diff === 0) {
        console.log('\n✅ Financial integrity: PASSED');
    } else {
        console.log('\n❌ Financial integrity: FAILED');
    }

    await disconnectDatabase();
    process.exit(0);
}

main().catch((err) => {
    console.error('Load test failed:', err);
    process.exit(1);
});
