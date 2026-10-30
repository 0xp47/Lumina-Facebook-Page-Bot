import { Request, Response, NextFunction } from 'express';
import { pageService } from '../services/page.service';

export class PageController {
  async getPageDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const pageId = req.query.pageId as string;
      const details = await pageService.getPageDetails(pageId);
      res.json({ success: true, data: details });
    } catch (error) {
      next(error);
    }
  }

  async getPageSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const pageId = req.query.pageId as string;
      const settings = await pageService.getPageSettings(pageId);
      res.json({ success: true, data: settings });
    } catch (error) {
      next(error);
    }
  }

  async publishPost(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { message, link, picture, published, scheduled_publish_time } = req.body;
      const pageId = req.query.pageId as string;

      if (!message) {
        res.status(400).json({ success: false, error: 'Field "message" is required' });
        return;
      }

      const result = await pageService.publishPost(
        { message, link, picture, published, scheduled_publish_time },
        pageId
      );
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getComments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const objectId = req.params.objectId;
      const result = await pageService.getComments(objectId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async postComment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const objectId = req.params.objectId;
      const { message } = req.body;
      if (!message) {
        res.status(400).json({ success: false, error: 'Field "message" is required' });
        return;
      }

      const result = await pageService.postComment(objectId, { message });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteComment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const commentId = req.params.commentId;
      const result = await pageService.deleteComment(commentId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getInsights(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const metrics = req.query.metrics
        ? (req.query.metrics as string).split(',')
        : undefined;
      const pageId = req.query.pageId as string;

      const result = await pageService.getPageInsights(metrics, pageId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getTaggedPosts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const pageId = req.query.pageId as string;
      const result = await pageService.getTaggedPosts(pageId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const pageController = new PageController();
