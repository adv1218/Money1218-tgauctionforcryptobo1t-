import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import * as userController from '../controllers/userController.js';
import * as auctionController from '../controllers/auctionController.js';

const router = Router();

router.post('/users', userController.createUser);
router.post('/users/login', userController.loginOrRegister);

router.get('/users/me', authMiddleware, userController.getMe);
router.post('/users/me/deposit', authMiddleware, userController.deposit);
router.get('/users/me/wins', authMiddleware, userController.getMyWins);
router.get('/users/me/bids', authMiddleware, userController.getMyBids);

router.get('/auctions', auctionController.getAllAuctions);
router.get('/auctions/:id', auctionController.getAuction);
router.get('/auctions/:id/leaderboard', auctionController.getLeaderboard);
router.get('/auctions/:id/bids/count', auctionController.getBidsCount);

router.post('/auctions', auctionController.createAuction);
router.post('/auctions/:id/bid', authMiddleware, auctionController.placeBid);
router.get('/auctions/:id/my-bid', authMiddleware, auctionController.getMyBid);

export { router };
