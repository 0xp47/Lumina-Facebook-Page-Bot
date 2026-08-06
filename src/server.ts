import app from './app';
import { env } from './config/env.config';
import { logger } from './utils/logger';

const PORT = env.port;

app.listen(PORT, () => {
  logger.info(`==================================================`);
  logger.info(`🚀 Facebook Page Bot Service running on port ${PORT}`);
  logger.info(`   Environment: ${env.nodeEnv}`);
  logger.info(`   Graph API Version: ${env.facebook.graphVersion}`);
  logger.info(`   Webhook URL: http://localhost:${PORT}/webhook`);
  logger.info(`==================================================`);
});
