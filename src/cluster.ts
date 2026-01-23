import cluster from 'cluster';
import os from 'os';

const numCPUs = parseInt(process.env.CLUSTER_WORKERS || '') || os.cpus().length;

if (cluster.isPrimary) {
    console.log(` Master ${process.pid} is running`);
    console.log(`   Spawning ${numCPUs} workers...`);


    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(`⚠️ Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
        cluster.fork();
    });

    cluster.on('online', (worker) => {
        console.log(`   Worker ${worker.process.pid} is online`);
    });

} else {

    import('./app.js');
}
