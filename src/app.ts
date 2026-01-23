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


    await app.register(fastifyCors, {
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'X-User-Id'],
    });


    await app.register(fastifyRateLimit, {
        max: 10000,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
            success: false,
            error: 'Too many requests, please slow down',
        }),
    });


    app.addHook('onRoute', (routeOptions) => {
        if (routeOptions.url === '/api/auctions/:id/bid' && routeOptions.method === 'POST') {
            routeOptions.config = {
                ...routeOptions.config,
                rateLimit: {
                    max: 5000,
                    timeWindow: '1 minute',
                },
            };
        }
    });


    await app.register(fastifyStatic, {
        root: path.join(__dirname, '../public'),
        prefix: '/',
    });


    app.get('/api/health', async () => ({
        success: true,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    }));


    await registerRoutes(app);


    app.setNotFoundHandler(async (request, reply) => {

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


    app.setErrorHandler((error, request, reply) => {
        request.log.error(error);


        if (error.validation) {
            return reply.status(400).send({
                success: false,
                error: 'Validation error',
                details: error.validation,
            });
        }


        if (error.statusCode === 429) {
            return reply.status(429).send({
                success: false,
                error: 'Too many requests',
            });
        }


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


    const futureAuctions = await Auction.find({
        status: 'pending',
        startAt: { $gt: now },
    });

    for (const auction of futureAuctions) {
        await scheduleAuctionStart(auction._id.toString(), auction.startAt);
    }

    console.log(`Scheduled ${futureAuctions.length} future auctions`);


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


function startAuctionPolling(): void {

    setInterval(async () => {
        try {
            await startOverdueAuctions();
        } catch (error) {
            console.error('Auction polling error:', error);
        }
    }, 5000);



    console.log('Auction polling started (5s)');
}

async function start(): Promise<void> {
    try {

        await connectDatabase();


        initializeQueues();


        const app = await buildApp();


        await app.listen({
            port: config.port,
            host: '0.0.0.0',
        });


        const io = new SocketServer(app.server, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST'],
            },
            pingTimeout: 60000,
            pingInterval: 25000,
        });


        initializeWebSocketWithServer(io);


        await schedulePendingAuctions();


        startAuctionPolling();

        console.log(` Server running on http://localhost:${config.port}`);
        console.log(` For mobile access use: http://<your-ip>:${config.port}`);
        console.log(` WebSocket enabled`);
        console.log(` Bull Queue processing enabled`);


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
