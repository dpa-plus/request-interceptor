import http from 'http';
import { createAdminApp } from './admin.js';
import { createProxyApp } from './proxy.js';
import { initDatabase } from './lib/prisma.js';
import { initSocketServer } from './lib/socketServer.js';
import { startCleanupScheduler } from './lib/cleanup.js';

const PORT_ADMIN = parseInt(process.env.PORT_ADMIN || '3000');
const PORT_PROXY = parseInt(process.env.PORT_PROXY || '3001');

async function main() {
  // Initialize database
  await initDatabase();

  // Create apps
  const adminApp = createAdminApp();
  const proxyApp = createProxyApp();

  // Create HTTP server for admin app (to attach Socket.IO)
  const adminServer = http.createServer(adminApp);

  // Initialize Socket.IO on the admin server
  initSocketServer(adminServer);

  // Start admin server with Socket.IO
  adminServer.listen(PORT_ADMIN, () => {
    console.log(`Admin server running on http://localhost:${PORT_ADMIN}`);
    console.log(`Socket.IO available at http://localhost:${PORT_ADMIN}/socket.io`);
  });

  // Start proxy server
  proxyApp.listen(PORT_PROXY, () => {
    console.log(`Proxy server running on http://localhost:${PORT_PROXY}`);
  });

  // Start cleanup scheduler
  startCleanupScheduler();
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
