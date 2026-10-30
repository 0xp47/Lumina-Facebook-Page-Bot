import { graphApiService } from './graphApi.service';
import { env } from '../config/env.config';
import {
  PageInfo,
  CreatePostPayload,
  CreatePostResponse,
  CommentsListResponse,
  CreateCommentPayload,
  CreateCommentResponse,
  InsightsListResponse,
  TaggedPost
} from '../types/facebook.types';
import { logger } from '../utils/logger';

export class PageService {
  private pageDetailsCache = new Map<string, { data: PageInfo; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute cache to eliminate redundant Graph API network hops

  private get pageId(): string {
    return env.facebook.pageId;
  }

  /**
   * GET /<PAGE_ID>?fields=id,name,about,fan_count,followers_count,link,category,cover
   * Retrieve basic information about a Page (cached for 5 minutes).
   */
  async getPageDetails(customPageId?: string): Promise<PageInfo> {
    const targetPageId = customPageId || this.pageId;
    const cached = this.pageDetailsCache.get(targetPageId);
    if (cached && Date.now() < cached.expiresAt) {
      logger.debug(`Serving Page details from in-memory cache for ${targetPageId}`);
      return cached.data;
    }

    const fields = 'id,name,about,description,fan_count,followers_count,link,category,cover';
    logger.info(`Fetching details for Page ID: ${targetPageId}`);
    const data = await graphApiService.get<PageInfo>(`/${targetPageId}`, { fields });
    this.pageDetailsCache.set(targetPageId, { data, expiresAt: Date.now() + this.CACHE_TTL_MS });
    return data;
  }

  /**
   * POST /{page-id}/feed
   * Create new posts on a Page feed.
   */
  async publishPost(payload: CreatePostPayload, customPageId?: string): Promise<CreatePostResponse> {
    const targetPageId = customPageId || this.pageId;
    logger.info(`Publishing post to Page ID: ${targetPageId}`, { message: payload.message });
    return graphApiService.post<CreatePostResponse>(`/${targetPageId}/feed`, payload);
  }

  /**
   * GET /{object-id}/comments
   * Read comments on a post or media object.
   */
  async getComments(objectId: string): Promise<CommentsListResponse> {
    logger.info(`Fetching comments for object ID: ${objectId}`);
    return graphApiService.get<CommentsListResponse>(`/${objectId}/comments`, {
      fields: 'id,message,created_time,from,like_count,comment_count'
    });
  }

  /**
   * POST /{object-id}/comments
   * Add a new comment to a post or existing comment.
   */
  async postComment(objectId: string, payload: CreateCommentPayload): Promise<CreateCommentResponse> {
    logger.info(`Posting comment to object ID: ${objectId}`);
    return graphApiService.post<CreateCommentResponse>(`/${objectId}/comments`, payload);
  }

  /**
   * DELETE /<COMMENT_ID>
   * Moderate/delete a comment by ID.
   */
  async deleteComment(commentId: string): Promise<{ success: boolean }> {
    logger.info(`Deleting comment ID: ${commentId}`);
    return graphApiService.delete<{ success: boolean }>(`/${commentId}`);
  }

  /**
   * GET /{page-id}/insights?metric=page_views_total,page_follows,page_post_engagements
   * Retrieve analytics and metrics for a Page.
   * NOTE: Meta renamed Page metrics - "page_impressions" -> "page_views_total"
   * and "page_fans" -> "page_follows". The old names now return error #100.
   */
  async getPageInsights(
    metrics: string[] = ['page_views_total', 'page_follows', 'page_post_engagements'],
    customPageId?: string
  ): Promise<InsightsListResponse> {
    const targetPageId = customPageId || this.pageId;
    const metricStr = metrics.join(',');
    logger.info(`Fetching insights for Page ID: ${targetPageId} [metrics: ${metricStr}]`);
    return graphApiService.get<InsightsListResponse>(`/${targetPageId}/insights`, {
      metric: metricStr
    });
  }

  /**
   * GET /{page-id}/tagged
   * Retrieve posts or comments where the Page is mentioned/tagged.
   */
  async getTaggedPosts(customPageId?: string): Promise<{ data: TaggedPost[] }> {
    const targetPageId = customPageId || this.pageId;
    logger.info(`Fetching tagged posts for Page ID: ${targetPageId}`);
    return graphApiService.get<{ data: TaggedPost[] }>(`/${targetPageId}/tagged`, {
      fields: 'id,message,created_time,from'
    });
  }

  /**
   * POST /{page-id}/settings or GET settings
   * Update Page description or settings.
   */
  async getPageSettings(customPageId?: string): Promise<Record<string, any>> {
    const targetPageId = customPageId || this.pageId;
    return graphApiService.get<Record<string, any>>(`/${targetPageId}`, {
      fields: 'cover,about,description'
    });
  }
}

export const pageService = new PageService();
