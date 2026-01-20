import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { router } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { roundProcessor } from './jobs/roundProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../public')));

app.use('/api', router);

app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(errorHandler);

async function start(): Promise<void> {
    await connectDatabase();

    roundProcessor.start();

    // Listen on 0.0.0.0 to allow access from other devices in local network
    app.listen(config.port, '0.0.0.0', () => {
        console.log(`Server running on http://localhost:${config.port}`);
        console.log(`For mobile access use: http://<your-ip>:${config.port}`);
    });
}

start().catch(console.error);
