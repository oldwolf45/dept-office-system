import express from 'express';
import { assignableUsers } from '../controllers/workController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);
router.get('/assignable-users', assignableUsers);

export default router;
