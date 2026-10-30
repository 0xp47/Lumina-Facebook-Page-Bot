import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import https from 'https';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';
import { AppError } from '../middlewares/errorHandler.middleware';

// High-performance reusable HTTPS agent with keep-alive socket pooling
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 15000,
  keepAliveMsecs: 60000
});

export class GraphApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: env.facebook.baseUrl,
      timeout: 10000,
      httpsAgent,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Intercept responses for consistent logging and error formatting
    this.client.interceptors.response.use(
      (response: AxiosResponse) => response,
      (error) => {
        if (error.response) {
          const fbError = error.response.data?.error;
          const status = error.response.status;
          const message = fbError?.message || error.message;
          logger.error(`Graph API Request Failed [${status}]: ${message}`, fbError);
          throw new AppError(status, message, fbError);
        }
        throw new AppError(500, error.message);
      }
    );
  }

  /**
   * Helper GET request appending page access token automatically
   */
  async get<T>(endpoint: string, params: Record<string, any> = {}): Promise<T> {
    const config: AxiosRequestConfig = {
      params: {
        access_token: env.facebook.pageAccessToken,
        ...params
      }
    };
    logger.debug(`GET ${endpoint}`, { params: config.params });
    const response = await this.client.get<T>(endpoint, config);
    return response.data;
  }

  /**
   * Helper POST request appending page access token automatically
   */
  async post<T>(endpoint: string, body: Record<string, any> = {}, params: Record<string, any> = {}): Promise<T> {
    const config: AxiosRequestConfig = {
      params: {
        access_token: env.facebook.pageAccessToken,
        ...params
      }
    };
    logger.debug(`POST ${endpoint}`, { body });
    const response = await this.client.post<T>(endpoint, body, config);
    return response.data;
  }

  /**
   * Helper DELETE request
   */
  async delete<T>(endpoint: string, params: Record<string, any> = {}): Promise<T> {
    const config: AxiosRequestConfig = {
      params: {
        access_token: env.facebook.pageAccessToken,
        ...params
      }
    };
    logger.debug(`DELETE ${endpoint}`);
    const response = await this.client.delete<T>(endpoint, config);
    return response.data;
  }
}

export const graphApiService = new GraphApiService();
