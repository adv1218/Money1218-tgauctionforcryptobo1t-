import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';

let io: Server | null = null;

// Initialize with existing Socket.io server instance (from app.ts)
export function initializeWebSocketWithServer(ioServer: Server): void {
    io = ioServer;

    io.on('connection', (socket) => {
        console.log(`Client connected: ${socket.id}`);

        // Join auction room
        socket.on('join:auction', (auctionId: string) => {
            socket.join(`auction:${auctionId}`);
            console.log(`Client ${socket.id} joined auction:${auctionId}`);
        });

        // Leave auction room
        socket.on('leave:auction', (auctionId: string) => {
            socket.leave(`auction:${auctionId}`);
            console.log(`Client ${socket.id} left auction:${auctionId}`);
        });

        socket.on('disconnect', () => {
            console.log(`Client disconnected: ${socket.id}`);
        });
    });

    console.log('WebSocket server initialized');
}

// Legacy function for backwards compatibility
export function initializeWebSocket(httpServer: HttpServer): Server {
    io = new Server(httpServer, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
        },
        pingTimeout: 60000,
        pingInterval: 25000,
    });

    io.on('connection', (socket) => {
        console.log(`Client connected: ${socket.id}`);

        socket.on('join:auction', (auctionId: string) => {
            socket.join(`auction:${auctionId}`);
            console.log(`Client ${socket.id} joined auction:${auctionId}`);
        });

        socket.on('leave:auction', (auctionId: string) => {
            socket.leave(`auction:${auctionId}`);
            console.log(`Client ${socket.id} left auction:${auctionId}`);
        });

        socket.on('disconnect', () => {
            console.log(`Client disconnected: ${socket.id}`);
        });
    });

    console.log('WebSocket server initialized');
    return io;
}

export function getIO(): Server {
    if (!io) {
        throw new Error('WebSocket not initialized');
    }
    return io;
}

// Emit new bid to auction room
export function emitNewBid(auctionId: string, data: {
    rank: number;
    amount: number;
    userId: string;
    totalBids: number;
}) {
    if (io) {
        io.to(`auction:${auctionId}`).emit('bid:new', data);
    }
}

// Emit round end
export function emitRoundEnd(auctionId: string, data: {
    roundNumber: number;
    winnersCount: number;
}) {
    if (io) {
        io.to(`auction:${auctionId}`).emit('round:end', data);
    }
}

// Emit new round start
export function emitRoundStart(auctionId: string, data: {
    roundNumber: number;
    endAt: Date;
    winnersCount: number;
}) {
    if (io) {
        io.to(`auction:${auctionId}`).emit('round:start', data);
    }
}

// Emit anti-sniping extension
export function emitAntiSnipe(auctionId: string, data: {
    newEndAt: Date;
    extension: number;
}) {
    if (io) {
        io.to(`auction:${auctionId}`).emit('timer:antiSnipe', data);
    }
}

// Emit auction started (broadcast to ALL clients so auction list updates)
export function emitAuctionStart(auctionId: string, data: {
    name: string;
    roundNumber: number;
    endAt: Date;
}) {
    if (io) {
        // Broadcast to all clients
        io.emit('auction:start', { auctionId, ...data });
        // Also emit to auction room
        io.to(`auction:${auctionId}`).emit('round:start', {
            roundNumber: data.roundNumber,
            endAt: data.endAt,
            winnersCount: 0,
        });
    }
}

// Emit auction completed
export function emitAuctionComplete(auctionId: string) {
    if (io) {
        io.to(`auction:${auctionId}`).emit('auction:complete', { auctionId });
        // Broadcast to all so auction list updates
        io.emit('auction:complete', { auctionId });
    }
}

// Emit leaderboard update
export function emitLeaderboardUpdate(auctionId: string, leaderboard: Array<{
    rank: number;
    userId: string;
    username: string;
    amount: number;
}>) {
    if (io) {
        io.to(`auction:${auctionId}`).emit('leaderboard:update', leaderboard);
    }
}
