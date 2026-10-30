import { Router } from 'express';
import { pageController } from '../controllers/page.controller';

const router = Router();

// Page Information & Details
router.get('/info', pageController.getPageDetails.bind(pageController));
router.get('/settings', pageController.getPageSettings.bind(pageController));

// Publishing & Feeds
router.post('/posts', pageController.publishPost.bind(pageController));

// Comment Management
router.get('/posts/:objectId/comments', pageController.getComments.bind(pageController));
router.post('/posts/:objectId/comments', pageController.postComment.bind(pageController));
router.delete('/comments/:commentId', pageController.deleteComment.bind(pageController));

// Insights & Analytics
router.get('/insights', pageController.getInsights.bind(pageController));

// Mentions / Tagged Posts
router.get('/tagged', pageController.getTaggedPosts.bind(pageController));

export default router;
