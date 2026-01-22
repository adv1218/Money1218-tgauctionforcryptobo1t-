import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';
import { Server as SocketServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

import { config } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { initializeWebSocketWithServer } from './websocket/index.js';
import { initializeQueues, closeQueues, scheduleAuctionStart } from './jobs/queues.js';
import { registerRoutes } from './routes/api.js';
import { Auction } from './models/index.js';
import { auctionService, roundService } from './services/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Extend Fastify types
declare module 'fastify' {
    interface FastifyRequest {
        userId?: mongoose.Types.ObjectId;
    }
}

async function buildApp(): Promise<FastifyInstance> {
    const app = Fastify({
        logger: {
            level: config.nodeEnv === 'production' ? 'info' : 'debug',
        },
        trustProxy: true,
    });

    // CORS
    await app.register(fastifyCors, {
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'X-User-Id'],
    });

    // Rate limiting (increased for load testing)
    await app.register(fastifyRateLimit, {
        max: 1000, // 1000 requests per minute per IP
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
            success: false,
            error: 'Too many requests, please slow down',
        }),
    });

    // Stricter rate limit for bid endpoint (increased for load testing)
    app.addHook('onRoute', (routeOptions) => {
        if (routeOptions.url === '/api/auctions/:id/bid' && routeOptions.method === 'POST') {
            routeOptions.config = {
                ...routeOptions.config,
                rateLimit: {
                    max: 500, // 500 bids per minute per IP
                    timeWindow: '1 minute',
                },
            };
        }
    });

    // Static files
    await app.register(fastifyStatic, {
        root: path.join(__dirname, '../public'),
        prefix: '/',
    });

    // Health check
    app.get('/api/health', async () => ({
        success: true,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    }));

    // Register API routes
    await registerRoutes(app);

    // SPA fallback - but not for socket.io paths
    app.setNotFoundHandler(async (request, reply) => {
        // Don't serve index.html for socket.io requests
        if (request.url.startsWith('/socket.io')) {
            return reply.status(404).send({ error: 'Not found' });
        }
        if (!request.url.startsWith('/api')) {
            return reply.sendFile('index.html');
        }
        return reply.status(404).send({
            success: false,
            error: 'Not found',
        });
    });

    // Error handler
    app.setErrorHandler((error, request, reply) => {
        request.log.error(error);

        // Zod validation errors
        if (error.validation) {
            return reply.status(400).send({
                success: false,
                error: 'Validation error',
                details: error.validation,
            });
        }

        // Rate limit errors
        if (error.statusCode === 429) {
            return reply.status(429).send({
                success: false,
                error: 'Too many requests',
            });
        }

        // Known errors
        const statusCode = error.statusCode || 500;
        return reply.status(statusCode).send({
            success: false,
            error: error.message || 'Internal server error',
        });
    });

    return app;
}

async function schedulePendingAuctions(): Promise<void> {
    const now = new Date();

    // Schedule future auctions
    const futureAuctions = await Auction.find({
        status: 'pending',
        startAt: { $gt: now },
    });

    for (const auction of futureAuctions) {
        await scheduleAuctionStart(auction._id.toString(), auction.startAt);
    }

    console.log(`Scheduled ${futureAuctions.length} future auctions`);

    // Start overdue auctions immediately
    await startOverdueAuctions();
}

async function startOverdueAuctions(): Promise<void> {
    const now = new Date();

    const overdueAuctions = await Auction.find({
        status: 'pending',
        startAt: { $lte: now },
    });

    console.log(`[Polling] Found ${overdueAuctions.length} overdue auctions`);

    for (const auction of overdueAuctions) {
        try {
            console.log(`[Polling] Starting overdue auction: ${auction.name} (startAt: ${auction.startAt})`);
            await auctionService.startAuction(auction._id);
            console.log(`[Polling] Successfully started: ${auction.name}`);
        } catch (error) {
            console.error(`[Polling] Failed to start auction ${auction.name}:`, error);
        }
    }
}

// Fallback polling - only for auctions (rounds are handled by Bull Queue only)
function startAuctionPolling(): void {
    // Auction polling - every 5 seconds
    setInterval(async () => {
        try {
            await startOverdueAuctions();
        } catch (error) {
            console.error('Auction polling error:', error);
        }
    }, 5000);

    // NOTE: Round polling REMOVED to avoid conflicts with Bull Queue
    // Rounds are ONLY processed by Bull Queue to prevent write conflicts

    console.log('Auction polling started (5s)');
}

async function start(): Promise<void> {
    try {
        // Connect to MongoDB
        await connectDatabase();

        // Initialize Bull queues
        initializeQueues();

        // Build Fastify app
        const app = await buildApp();

        // Start Fastify server first
        await app.listen({
            port: config.port,
            host: '0.0.0.0',
        });

        // Now initialize Socket.io on Fastify's server
        const io = new SocketServer(app.server, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST'],
            },
            pingTimeout: 60000,
            pingInterval: 25000,
        });

        // Initialize WebSocket handlers
        initializeWebSocketWithServer(io);

        // Schedule pending auctions
        await schedulePendingAuctions();

        // Start fallback polling for auctions
        startAuctionPolling();

        console.log(`🚀 Server running on http://localhost:${config.port}`);
        console.log(`📱 For mobile access use: http://<your-ip>:${config.port}`);
        console.log(`🔌 WebSocket enabled`);
        console.log(`📊 Bull Queue processing enabled`);

        // Graceful shutdown
        const shutdown = async (signal: string) => {
            console.log(`\n${signal} received. Shutting down gracefully...`);

            try {
                await app.close();
                await closeQueues();
                await mongoose.disconnect();
                console.log('Cleanup complete. Exiting.');
                process.exit(0);
            } catch (error) {
                console.error('Error during shutdown:', error);
                process.exit(1);
            }
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

start();
