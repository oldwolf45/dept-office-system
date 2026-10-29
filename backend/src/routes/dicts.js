import express from 'express';
import { requireAuth, requireLevel } from '../middleware/auth.js';
import { listActive, manageList, create, update, disable, enable } from '../controllers/dictController.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', listActive);
router.get('/manage', requireLevel(3), manageList);
router.post('/', requireLevel(3), create);
router.put('/:id', requireLevel(3), update);
router.post('/:id/disable', requireLevel(3), disable);
router.post('/:id/enable', requireLevel(3), enable);

export default router;
