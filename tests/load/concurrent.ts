/**
 * Concurrent Load Test - 200 simultaneous bids from 200 users
 * Tests system under high concurrent load
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000/api';

interface User {
    id: string;
    username: string;
}

async function api(endpoint: string, options: RequestInit = {}): Promise<any> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
    const data = await response.json();
    if (!data.success) {
        throw new Error(data.error || 'API error');
    }
    return data.data;
}

async function createUsers(count: number): Promise<User[]> {
    console.log(`Creating ${count} users...`);
    const users: User[] = [];

    // Create users in batches to avoid overwhelming the server
    const batchSize = 10;
    for (let i = 0; i < count; i += batchSize) {
        const batch = Math.min(batchSize, count - i);
        const promises = [];

        for (let j = 0; j < batch; j++) {
            const username = `loadtest_${Date.now()}_${i + j}`;
            promises.push(
                api('/users/login', {
                    method: 'POST',
                    body: JSON.stringify({ username }),
                }).catch(e => {
                    console.error(`Failed to create user ${username}:`, e.message);
                    return null;
                })
            );
        }

        const results = await Promise.all(promises);
        users.push(...results.filter(Boolean));
        process.stdout.write(`\r  Created ${users.length}/${count} users`);
    }
    console.log('');
    return users;
}

async function depositToUsers(users: User[]): Promise<void> {
    console.log(`Depositing 10000 stars to ${users.length} users...`);

    const batchSize = 10;
    let completed = 0;

    for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        await Promise.all(
            batch.map(user =>
                api('/users/me/deposit', {
                    method: 'POST',
                    body: JSON.stringify({ amount: 10000 }),
                    headers: { 'X-User-Id': user.id },
                }).catch(() => null)
            )
        );
        completed += batch.length;
        process.stdout.write(`\r  Deposited to ${completed}/${users.length} users`);
    }
    console.log('');
}

async function createAuction(): Promise<string> {
    console.log('Creating test auction...');
    const startAt = new Date(Date.now() + 5000); // Start in 5 seconds

    const auction = await api('/auctions', {
        method: 'POST',
        body: JSON.stringify({
            totalItems: 100, // For 200 users test
            totalRounds: 10,
            winnersPerRound: 10,
            startAt: startAt.toISOString(),
            firstRoundDuration: 60000, // 1 minute
            otherRoundDuration: 30000,
        }),
    });

    console.log(`  Auction created: ${auction.id}`);
    console.log(`  Starting at: ${startAt.toISOString()}`);
    return auction.id;
}

async function waitForAuctionStart(auctionId: string): Promise<void> {
    console.log('Waiting for auction to start...');

    while (true) {
        const auction = await api(`/auctions/${auctionId}`);
        if (auction.status === 'active') {
            console.log('  Auction is now ACTIVE!');
            return;
        }
        await new Promise(r => setTimeout(r, 500));
    }
}

async function placeConcurrentBids(users: User[], auctionId: string): Promise<{
    success: number;
    failed: number;
    times: number[];
}> {
    console.log(`\n🚀 Placing ${users.length} SIMULTANEOUS bids...`);

    const results = {
        success: 0,
        failed: 0,
        times: [] as number[],
    };

    // Generate random bid amounts for each user (100-5000)
    const bids = users.map((user, i) => ({
        user,
        amount: 100 + Math.floor(Math.random() * 4900),
    }));

    const startTime = Date.now();

    // Fire ALL bids simultaneously
    const promises = bids.map(async ({ user, amount }) => {
        const bidStart = Date.now();
        try {
            await api(`/auctions/${auctionId}/bid`, {
                method: 'POST',
                body: JSON.stringify({ amount }),
                headers: { 'X-User-Id': user.id },
            });
            results.success++;
            results.times.push(Date.now() - bidStart);
        } catch (e: any) {
            results.failed++;
            // Don't log each error, just count
        }
    });

    await Promise.all(promises);

    const totalTime = Date.now() - startTime;
    console.log(`  Total time: ${totalTime}ms`);
    console.log(`  Successful: ${results.success}`);
    console.log(`  Failed: ${results.failed}`);

    if (results.times.length > 0) {
        const avgTime = results.times.reduce((a, b) => a + b, 0) / results.times.length;
        const maxTime = Math.max(...results.times);
        const minTime = Math.min(...results.times);
        console.log(`  Response times: min=${minTime}ms, avg=${Math.round(avgTime)}ms, max=${maxTime}ms`);
    }

    return results;
}

async function getStats(auctionId: string): Promise<void> {
    console.log('\n📊 Final Statistics:');

    const auction = await api(`/auctions/${auctionId}`);
    const leaderboard = await api(`/auctions/${auctionId}/leaderboard?limit=10`);

    console.log(`  Total bids in round: ${auction.activeRound?.totalBids || 0}`);
    console.log(`  Min bid for win: ${auction.activeRound?.minBidForWin || 0}`);
    console.log('\n  Top 10 Leaderboard:');

    leaderboard.forEach((entry: any, i: number) => {
        console.log(`    ${i + 1}. ${entry.username}: ⭐ ${entry.amount}`);
    });
}

async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('  CONCURRENT LOAD TEST - 200 Simultaneous Bids');
    console.log('═══════════════════════════════════════════\n');

    const USER_COUNT = 200;

    try {
        // Step 1: Create users
        const users = await createUsers(USER_COUNT);
        if (users.length < USER_COUNT) {
            console.log(`⚠️  Only created ${users.length} users`);
        }

        // Step 2: Deposit to users
        await depositToUsers(users);

        // Step 3: Create auction
        const auctionId = await createAuction();

        // Step 4: Wait for auction to start
        await waitForAuctionStart(auctionId);

        // Step 5: Place ALL bids simultaneously
        const results = await placeConcurrentBids(users, auctionId);

        // Step 6: Get stats
        await getStats(auctionId);

        console.log('\n═══════════════════════════════════════════');
        if (results.success >= USER_COUNT * 0.9) {
            console.log('  ✅ LOAD TEST PASSED');
        } else {
            console.log('  ❌ LOAD TEST FAILED (too many errors)');
        }
        console.log('═══════════════════════════════════════════\n');

    } catch (error: any) {
        console.error('\n❌ Load test failed:', error.message);
        process.exit(1);
    }
}

main();
