import app from './app';
import { env } from './config/env.config';
import { logger } from './utils/logger';

const PORT = env.port;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  logger.info(`==================================================`);
  logger.info(`🚀 Facebook Page Bot Service running on port ${PORT}`);
  logger.info(`   Environment: ${env.nodeEnv}`);
  logger.info(`   Graph API Version: ${env.facebook.graphVersion}`);
  logger.info(`   Webhook URL: http://${HOST}:${PORT}/webhook`);
  logger.info(`==================================================`);
});
