import express from 'express';
import { listOperations, listLogin } from '../controllers/logController.js';
import { requireAuth, requireLevel } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);
router.get('/operations', requireLevel(3), listOperations);
router.get('/login', requireLevel(3), listLogin);

export default router;
