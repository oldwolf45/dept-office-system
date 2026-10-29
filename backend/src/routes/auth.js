import express from 'express';
import { login, me, changePassword, logout } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.post('/login', login);
router.get('/me', requireAuth, me);
router.post('/change-password', requireAuth, changePassword);
router.post('/logout', requireAuth, logout);

export default router;
