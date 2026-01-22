import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/database.js';
import { auctionService, roundService } from '../../src/services/index.js';
import { runBots } from '../../src/jobs/botRunner.js';
import { initializeQueues, closeQueues, scheduleRoundProcessing } from '../../src/jobs/queues.js';
import { Bid, User, Auction, Round } from '../../src/models/index.js';

async function main() {
    console.log('Starting load test...\n');

    await connectDatabase();
    initializeQueues();

    const startDate = new Date(Date.now() + 5000);

    const auction = await auctionService.create({
        name: 'Load Test Auction',
        totalItems: 50,
        totalRounds: 5,
        startAt: startDate,
        firstRoundDuration: 30000,
        otherRoundDuration: 15000,
    });

    console.log(`Created auction: ${auction.name}`);
    console.log(`Items: ${auction.totalItems}, Rounds: ${auction.totalRounds}`);
    console.log(`Starting at: ${startDate.toISOString()}\n`);

    // Wait for auction to start
    console.log('Waiting for auction to start...');
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Start the auction manually
    await auctionService.startAuction(auction._id);
    console.log('Auction started!\n');

    const botRunner = await runBots({
        count: 10,
        minBid: 100,
        maxBid: 1000,
        intervalMs: 500,
    });

    console.log('\nWaiting for auction to complete...\n');

    await new Promise<void>((resolve) => {
        const checkInterval = setInterval(async () => {
            const a = await Auction.findById(auction._id);
            if (a?.status === 'completed') {
                clearInterval(checkInterval);
                resolve();
            }
        }, 1000);
    });

    botRunner.stop();

    console.log('\n=== RESULTS ===\n');

    const finalAuction = await Auction.findById(auction._id);
    console.log(`Distributed items: ${finalAuction?.distributedItems}`);
    console.log(`Average price: ${Math.round(finalAuction?.avgPrice || 0)} stars`);

    const winners = await Bid.find({ auctionId: auction._id, status: 'won' }).sort({ itemNumber: 1 });
    console.log(`\nWinners: ${winners.length}`);

    const totalSpent = winners.reduce((sum, b) => sum + b.amount, 0);
    console.log(`Total spent: ${totalSpent} stars`);

    const users = await User.find({ username: /^bot_/ });
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

    await closeQueues();
    await disconnectDatabase();
    process.exit(0);
}

main().catch((err) => {
    console.error('Load test failed:', err);
    process.exit(1);
});
