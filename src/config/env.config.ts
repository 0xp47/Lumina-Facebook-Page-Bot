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
  /** Comma-separated Messenger PSIDs allowed to run publisher commands (e.g. /post). */
  adminPsids: string[];
  nimji: {
    cookies: string;
    atToken: string;
    fSid: string;
    blParam: string;
  };
}

export const env: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  facebook: {
    graphVersion: process.env.FACEBOOK_GRAPH_VERSION || 'v26.0',
    pageAccessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '',
    appSecret: process.env.FACEBOOK_APP_SECRET || '',
    verifyToken: process.env.FACEBOOK_VERIFY_TOKEN || '',
    pageId: process.env.FACEBOOK_PAGE_ID || '',
    baseUrl: `https://graph.facebook.com/${process.env.FACEBOOK_GRAPH_VERSION || 'v26.0'}`
  },
  adminPsids: (process.env.FACEBOOK_ADMIN_PSIDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean),
  nimji: {
    cookies: process.env.COOKIES || '',
    atToken: process.env.AT_TOKEN || '',
    fSid: process.env.F_SID || '',
    blParam: process.env.BL_PARAM || 'boq_assistant-bard-web-server_20260427.06_p7'
  }
};
