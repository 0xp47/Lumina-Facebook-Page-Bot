import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface AppConfig {
  port: number;
  nodeEnv: string;
  facebook: {
    graphVersion: string;
    pageAccessToken: string;
    appSecret: string;
    verifyToken: string;
    pageId: string;
    baseUrl: string;
  };
}

export const env: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  facebook: {
    graphVersion: process.env.FACEBOOK_GRAPH_VERSION || 'v21.0',
    pageAccessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '',
    appSecret: process.env.FACEBOOK_APP_SECRET || '',
    verifyToken: process.env.FACEBOOK_VERIFY_TOKEN || '',
    pageId: process.env.FACEBOOK_PAGE_ID || '',
    baseUrl: `https://graph.facebook.com/${process.env.FACEBOOK_GRAPH_VERSION || 'v21.0'}`
  }
};
